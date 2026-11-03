using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Nightjar
{
    /// <summary>
    /// Bit-perfect playback on this computer: the file's samples go to the chosen sound device in WASAPI
    /// exclusive mode, with the device switched to the file's own sample rate, so Windows' mixer never
    /// touches them. Nothing here assumes a particular device: each one is asked which formats it takes,
    /// and a file that can't be played untouched is handed back to the normal player with the reason.
    /// Only the sample container may change (16-bit audio in a 24- or 32-bit slot, padded with zeros),
    /// which leaves the audio itself identical.
    /// </summary>
    static class BitPerfect
    {
        static readonly int[] Rates = { 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000 };
        static readonly int[] Depths = { 16, 24, 32 };

        static readonly object gate = new object(), turn = new object();
        static WasapiOut output;
        static PcmFeed feed;
        static string path, deviceName, formatText, failure;
        static double duration, startAt;
        static string state = "idle"; // idle, playing, paused, ended, failed
        static bool shared; // the current track goes through Windows' mixer (the device wouldn't take it as it is)
        static double volume = 1;

        // After a while paused the device is let go, so other programs can use it; playing again takes it back.
        static readonly TimeSpan ParkAfter = TimeSpan.FromSeconds(30);
        static System.Threading.Timer parkTimer;
        static bool parked;
        static double parkedAt;
        static string lastDevice;

        /// <summary>True while the engine has a track (playing, paused or just ended): the window takes the media keys then.</summary>
        public static event Action<bool> Holding;
        static bool holding;

        static void Notify()
        {
            bool now;
            lock (gate) now = path != null && (state == "playing" || state == "paused" || state == "ended");
            if (now == holding) return;
            holding = now;
            var h = Holding;
            if (h != null) System.Threading.Tasks.Task.Run(() => h(now));
        }

        // --- Devices ------------------------------------------------------------------------------

        static MMDevice Find(MMDeviceEnumerator en, string id)
        {
            if (!string.IsNullOrEmpty(id))
                try { var d = en.GetDevice(id); if (d.State == DeviceState.Active) return d; } catch { }
            return en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        }

        static WaveFormat Make(int rate, int container, int channels)
        {
            if (container == 16 && channels <= 2) return new WaveFormat(rate, 16, channels);
            return new PcmExtensible(rate, container, channels);
        }

        /// <summary>
        /// Integer samples in a 24- or 32-bit slot. NAudio's own WaveFormatExtensible calls every 32-bit format
        /// floating point, which would send whole numbers to a device expecting floats.
        /// </summary>
        [StructLayout(LayoutKind.Sequential, Pack = 2)]
        sealed class PcmExtensible : WaveFormat
        {
            readonly short validBits;
            readonly int channelMask;
            readonly Guid subFormat = new Guid("00000001-0000-0010-8000-00aa00389b71"); // KSDATAFORMAT_SUBTYPE_PCM

            public PcmExtensible(int rate, int bits, int channels) : base(rate, bits, channels)
            {
                waveFormatTag = WaveFormatEncoding.Extensible;
                extraSize = 22;
                validBits = (short)bits;
                channelMask = channels == 1 ? 4 : 3; // centre, or front left and right
            }

            public override void Serialize(BinaryWriter writer)
            {
                base.Serialize(writer);
                writer.Write(validBits);
                writer.Write(channelMask);
                writer.Write(subFormat.ToByteArray());
            }

            public override string ToString() => "PCM " + SampleRate + " Hz " + BitsPerSample + "-bit " + Channels + " ch (extensible)";
        }

        static bool Accepts(MMDevice dev, WaveFormat f)
        {
            try { return dev.AudioClient.IsFormatSupported(AudioClientShareMode.Exclusive, f); }
            catch { return false; }
        }

        /// <summary>Every active output with the exclusive-mode formats it says it accepts.</summary>
        public static object Devices()
        {
            var list = new List<object>();
            try
            {
                using (var en = new MMDeviceEnumerator())
                {
                    string def = null;
                    try { def = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia).ID; } catch { }
                    foreach (var dev in en.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
                    {
                        var formats = new List<string>();
                        foreach (var r in Rates)
                        {
                            var depths = Depths.Where(b => Accepts(dev, Make(r, b, 2))).ToList();
                            if (depths.Count > 0) formats.Add(r + ":" + string.Join("/", depths));
                        }
                        list.Add(new { id = dev.ID, name = dev.FriendlyName, isDefault = dev.ID == def, exclusive = formats });
                    }
                }
            }
            catch (Exception e) { Log.Write("Bit-perfect: couldn't list the sound devices: " + e.Message); }
            return new { devices = list };
        }

        // --- Deciding whether a file can be played untouched ----------------------------------------

        sealed class Plan
        {
            public PcmSource Source;
            public WaveFormat Format;
            public int Container;
            public string Why;
            public string Describe;
            /// <summary>Not untouched on this device: it still plays there, through Windows' mixer, which converts it.</summary>
            public bool Shared;
        }

        static Plan SharedPlan(MMDevice dev, PcmSource src, string why)
        {
            int slot = src.Bits <= 16 ? 16 : 32;
            string to = null;
            try { to = Khz(dev.AudioClient.MixFormat.SampleRate); } catch { }
            return new Plan
            {
                Source = src, Format = Make(src.Rate, slot, 2), Container = slot, Shared = true, Why = why,
                Describe = to == null ? "converted by Windows" : to == Khz(src.Rate) ? "through Windows at " + to : "converted by Windows to " + to,
            };
        }

        static Plan MakePlan(MMDevice dev, string file)
        {
            PcmSource src = null;
            string ext = Path.GetExtension(file).ToLowerInvariant();
            try
            {
                if (ext == ".flac") src = FlacSource.Open(file);
                else if (ext == ".wav") src = WavSource.Open(file);
                else return new Plan { Why = "Only FLAC and WAV files play this way for now." };
            }
            catch (Exception e) { return new Plan { Why = "nightjar couldn't open the file: " + e.Message }; }
            if (src == null) return new Plan { Why = "The file's format isn't one this player can pass through untouched." };
            if (src.Channels > 2) { src.Dispose(); return new Plan { Why = "Files with more than two channels play in the normal player." }; }

            int devChannels = 2; // a mono file is sent to both sides
            // Same rate, the file's own depth first, then wider slots for devices that only take 24 or 32 bits.
            foreach (var slot in Depths.Where(b => b >= src.Bits))
            {
                var f = Make(src.Rate, slot, devChannels);
                if (Accepts(dev, f))
                {
                    var how = slot == src.Bits ? "" : " in a " + slot + "-bit slot";
                    return new Plan
                    {
                        Source = src, Format = f, Container = slot,
                        Describe = src.Bits + "-bit / " + Khz(src.Rate) + how + ", exclusive",
                    };
                }
            }
            return SharedPlan(dev, src, dev.FriendlyName + " doesn't accept " + src.Bits + "-bit / " + Khz(src.Rate) + " in exclusive mode.");
        }

        static string Khz(int rate) => Math.Round(rate / 1000.0, 1).ToString(System.Globalization.CultureInfo.InvariantCulture) + " kHz";

        /// <summary>Can this file be played on this device, and untouched (`exclusive`)? Doesn't play anything.</summary>
        public static object Check(string file, string deviceId)
        {
            try
            {
                using (var en = new MMDeviceEnumerator())
                {
                    var dev = Find(en, deviceId);
                    var plan = MakePlan(dev, file);
                    var seconds = plan.Source != null ? plan.Source.Frames / (double)plan.Source.Rate : 0;
                    plan.Source?.Dispose();
                    return new { ok = plan.Source != null, exclusive = plan.Source != null && !plan.Shared, format = plan.Describe, reason = plan.Why, device = dev.FriendlyName, duration = seconds };
                }
            }
            catch (Exception e) { return new { ok = false, reason = "No sound device is available: " + e.Message }; }
        }

        // --- Playing -------------------------------------------------------------------------------

        public static object Play(string file, double from, string deviceId)
        {
            try { return Start(file, from, deviceId); }
            finally { Notify(); }
        }

        static object Start(string file, double from, string deviceId)
        {
            lock (turn)
            {
                Release();
                lock (gate)
                try
                {
                    parked = false;
                    parkTimer?.Dispose(); parkTimer = null;
                    using (var en = new MMDeviceEnumerator())
                    {
                        var dev = Find(en, deviceId);
                        var plan = MakePlan(dev, file);
                        if (plan.Source == null) return Fail(plan.Why);

                        if (from > 0) plan.Source.Seek((long)(from * plan.Source.Rate));
                        var f = new PcmFeed(plan.Source, plan.Container / 8, plan.Format.Channels);
                        var o = new WasapiOut(dev, plan.Shared ? AudioClientShareMode.Shared : AudioClientShareMode.Exclusive, true, plan.Shared ? 200 : 100);
                        try { o.Init(f); }
                        catch (Exception e) when (!plan.Shared && Refused(e))
                        {
                            // Windows doesn't let programs take this device for themselves: play it the shared way.
                            o.Dispose();
                            var why = Explain(e, dev.FriendlyName);
                            plan = SharedPlan(dev, plan.Source, why);
                            f = new PcmFeed(plan.Source, plan.Container / 8, plan.Format.Channels);
                            o = new WasapiOut(dev, AudioClientShareMode.Shared, true, 200);
                            try { o.Init(f); }
                            catch (Exception e2) { o.Dispose(); f.Dispose(); return Fail(Explain(e2, dev.FriendlyName)); }
                        }
                        catch (Exception e)
                        {
                            o.Dispose(); f.Dispose();
                            return Fail(Explain(e, dev.FriendlyName));
                        }
                        if (plan.Shared) try { o.Volume = (float)volume; } catch { }
                        var name = dev.FriendlyName;
                        o.PlaybackStopped += (s, a) =>
                        {
                            lock (gate)
                            {
                                if (output != s) return;
                                // Stopping before a single sample came out means the decoder failed, not that the track ended.
                                if (a.Exception != null) { state = "failed"; failure = Explain(a.Exception, name); }
                                else if (f.Frames == 0) { state = "failed"; failure = "nightjar couldn't decode " + Path.GetFileName(file) + "."; }
                                else state = "ended";
                                if (state == "failed") Log.Write("Bit-perfect stopped: " + failure);
                            }
                            Notify();
                        };
                        output = o; feed = f; lastDevice = deviceId; shared = plan.Shared;
                        path = file; deviceName = name; formatText = plan.Describe;
                        duration = plan.Source.Frames / (double)plan.Source.Rate; startAt = from;
                        failure = plan.Shared ? plan.Why : null;
                        o.Play();
                        state = "playing";
                        Log.Write((plan.Shared ? "Through Windows (" + plan.Why + "): " : "Bit-perfect: ") + Path.GetFileName(file) + " on " + deviceName + " (" + formatText + ")");
                        return Status();
                    }
                }
                catch (Exception e) { return Fail("nightjar couldn't start the sound device: " + e.Message); }
            }
        }

        static string Explain(Exception e, string device)
        {
            var hr = (uint)e.HResult;
            if (hr == 0x8889000A) return device + " is being used by another program in exclusive mode.";
            if (hr == 0x88890008) return device + " doesn't accept that format.";
            if (hr == 0x88890004 || hr == 0x88890026) return device + " was disconnected.";
            if (Refused(e)) return "Windows isn't letting programs take exclusive control of " + device + ". Turn on \"Allow applications to take exclusive control\" in the device's properties.";
            return device + " stopped: " + e.Message;
        }

        /// <summary>Exclusive mode is switched off for the device (its "Allow applications to take exclusive control" box, or a policy).</summary>
        static bool Refused(Exception e)
        {
            var hr = (uint)e.HResult;
            return hr == 0x8889000E || hr == 0x80070005;
        }

        /// <summary>The volume for tracks played through Windows (0 to 1). Untouched tracks ignore it: that's what keeps them untouched.</summary>
        public static object SetVolume(double v)
        {
            lock (gate)
            {
                volume = Math.Max(0, Math.Min(1, v));
                if (output != null && shared) try { output.Volume = (float)volume; } catch { }
            }
            return Status();
        }

        static object Fail(string why)
        {
            state = "failed"; failure = why;
            Log.Write("Bit-perfect not used: " + why);
            return Status();
        }

        // Pausing keeps the stream running and sends silence: stopping an exclusive stream makes some
        // devices repeat their last buffer, which sounds like the track got stuck.
        public static object Pause()
        {
            lock (gate)
            {
                if (feed != null && state == "playing")
                {
                    feed.Paused = true;
                    state = "paused";
                    parkTimer?.Dispose();
                    parkTimer = new System.Threading.Timer(_ => Park(), null, ParkAfter, System.Threading.Timeout.InfiniteTimeSpan);
                }
                return Status();
            }
        }

        public static object Resume()
        {
            string file, device; double at;
            lock (turn)
            {
                lock (gate)
                {
                    if (feed != null && state == "paused")
                    {
                        feed.Paused = false;
                        state = "playing";
                        parkTimer?.Dispose(); parkTimer = null;
                        return Status();
                    }
                    if (!parked || state != "paused" || path == null) return Status();
                    file = path; device = lastDevice; at = parkedAt;
                }
                // Let go of during the pause: open the device again where the track was.
                return Play(file, at, device);
            }
        }

        /// <summary>Still paused after a while: lets go of the device but keeps the track and the place in it.</summary>
        static void Park()
        {
            lock (turn)
            {
                lock (gate)
                {
                    if (state != "paused" || feed == null || parked) return;
                    parkedAt = Position();
                    parked = true; // from here the position comes from parkedAt
                }
                Release();
                Log.Write("Bit-perfect: paused a while, so the sound device is free for other programs");
            }
        }

        public static object Stop()
        {
            lock (turn)
            {
                Release();
                lock (gate) { state = "idle"; path = null; failure = null; parked = false; parkTimer?.Dispose(); parkTimer = null; }
                Notify();
                return Status();
            }
        }

        /// <summary>
        /// Lets go of the device. Stopping waits for NAudio's playback thread, and that thread takes `gate` to
        /// report the stop, so the waiting happens outside `gate`; `turn` keeps two starts from overlapping.
        /// </summary>
        static void Release()
        {
            WasapiOut o; PcmFeed f;
            lock (gate) { o = output; f = feed; output = null; feed = null; }
            try { o?.Stop(); } catch { }
            try { o?.Dispose(); } catch { }
            try { f?.Dispose(); } catch { }
        }

        public static object Status()
        {
            lock (gate) return new { state, path, position = Position(), duration, exclusive = !shared, format = formatText, device = deviceName, reason = failure };
        }

        static double Position()
        {
            lock (gate)
            {
                double pos = parked ? parkedAt : feed != null ? startAt + feed.Frames / (double)Math.Max(1, feed.Rate) - 0.1 : (state == "ended" ? duration : 0);
                if (pos < 0) pos = 0;
                if (duration > 0 && pos > duration) pos = duration;
                return pos;
            }
        }

        // --- Putting the file's samples into the device's slots, nothing else ----------------------------

        sealed class PcmFeed : IWaveProvider
        {
            readonly PcmSource src;
            readonly int slot, srcBytes, devChannels;
            byte[] tmp = new byte[0];
            bool finished;
            public volatile bool Paused;
            public long Frames;
            public int Rate => src.Rate;
            public WaveFormat WaveFormat { get; }

            [ThreadStatic] static bool scheduled;
            [DllImport("avrt.dll", CharSet = CharSet.Unicode)] static extern IntPtr AvSetMmThreadCharacteristics(string task, ref uint index);

            public PcmFeed(PcmSource src, int slotBytes, int devChannels)
            {
                this.src = src; slot = slotBytes; this.devChannels = devChannels; srcBytes = src.Bits / 8;
                WaveFormat = Make(src.Rate, slotBytes * 8, devChannels);
            }

            public int Read(byte[] buffer, int offset, int count)
            {
                // Only NAudio's playback thread calls this: put it in Windows' audio schedule, so a busy
                // computer doesn't make it miss a buffer (the device would repeat the old one).
                if (!scheduled) { scheduled = true; uint i = 0; try { AvSetMmThreadCharacteristics("Pro Audio", ref i); } catch { } }

                int outFrame = slot * devChannels, inFrame = srcBytes * src.Channels;
                int frames = count / outFrame;
                if (finished) return 0;
                if (Paused) { Array.Clear(buffer, offset, frames * outFrame); return frames * outFrame; }
                if (tmp.Length < frames * inFrame) tmp = new byte[frames * inFrame];
                int got = 0;
                while (got < frames * inFrame)
                {
                    int n = src.Read(tmp, got, frames * inFrame - got);
                    if (n <= 0) break;
                    got += n;
                }
                int done = got / inFrame;
                int pad = slot - srcBytes;
                for (int i = 0; i < done; i++)
                {
                    for (int c = 0; c < devChannels; c++)
                    {
                        int from = i * inFrame + Math.Min(c, src.Channels - 1) * srcBytes;
                        int to = offset + i * outFrame + c * slot;
                        for (int z = 0; z < pad; z++) buffer[to + z] = 0;
                        Buffer.BlockCopy(tmp, from, buffer, to + pad, srcBytes);
                    }
                }
                Frames += done;
                if (done == frames) return done * outFrame;
                // The file ran out: an exclusive device wants whole buffers, so fill the last one with silence.
                finished = true;
                if (done == 0) return 0;
                Array.Clear(buffer, offset + done * outFrame, (frames - done) * outFrame);
                return frames * outFrame;
            }

            public void Dispose() => src.Dispose();
        }

        // --- Where the samples come from ----------------------------------------------------------------

        abstract class PcmSource : IDisposable
        {
            public int Rate, Channels, Bits;
            public long Frames;
            public abstract int Read(byte[] buffer, int offset, int count);
            public abstract void Seek(long frame);
            public abstract void Dispose();
        }

        /// <summary>A FLAC file unpacked by flac.exe (it ships with nightjar), restarted at the right sample to seek.</summary>
        sealed class FlacSource : PcmSource
        {
            string file;
            Process proc;
            Stream pipe;

            public static PcmSource Open(string file)
            {
                var exe = Path.Combine(Paths.Root, "tools", "flac.exe");
                var info = Media.FlacStreamInfo(file);
                if (info == null || !File.Exists(exe)) return null;
                var s = new FlacSource { file = file, Rate = info.Value.rate, Channels = info.Value.channels, Bits = info.Value.bits, Frames = info.Value.samples };
                s.Seek(0);
                return s;
            }

            public override void Seek(long frame)
            {
                Kill();
                var psi = new ProcessStartInfo(Path.Combine(Paths.Root, "tools", "flac.exe"),
                    "-d -c -s --force-raw-format --endian=little --sign=signed" + (frame > 0 ? " --skip=" + frame : "") + " \"" + file + "\"")
                {
                    UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                };
                proc = Process.Start(psi);
                proc.ErrorDataReceived += (s, e) => { };
                proc.BeginErrorReadLine();
                pipe = proc.StandardOutput.BaseStream;
            }

            public override int Read(byte[] buffer, int offset, int count) => pipe.Read(buffer, offset, count);

            void Kill()
            {
                try { if (proc != null && !proc.HasExited) proc.Kill(); } catch { }
                try { proc?.Dispose(); } catch { }
                proc = null; pipe = null;
            }

            public override void Dispose() => Kill();
        }

        /// <summary>An integer PCM WAV file, read as it is.</summary>
        sealed class WavSource : PcmSource
        {
            WaveFileReader reader;

            public static PcmSource Open(string file)
            {
                var r = new WaveFileReader(file);
                var fmt = r.WaveFormat;
                bool pcm = fmt.Encoding == WaveFormatEncoding.Pcm
                    || (fmt is WaveFormatExtensible x && x.SubFormat == new Guid("00000001-0000-0010-8000-00aa00389b71"));
                if (!pcm || (fmt.BitsPerSample != 16 && fmt.BitsPerSample != 24 && fmt.BitsPerSample != 32)) { r.Dispose(); return null; }
                return new WavSource { reader = r, Rate = fmt.SampleRate, Channels = fmt.Channels, Bits = fmt.BitsPerSample, Frames = r.Length / fmt.BlockAlign };
            }

            public override int Read(byte[] buffer, int offset, int count) => reader.Read(buffer, offset, count);
            public override void Seek(long frame) => reader.Position = frame * reader.WaveFormat.BlockAlign;
            public override void Dispose() => reader.Dispose();
        }
    }
}
