using System;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading;
using System.Web.Script.Serialization;

namespace Nightjar
{
    /// <summary>
    /// Asks the router to forward Soulseek's listening port to this computer (UPnP),
    /// the way SoulseekQt does. Without it, people behind their own firewalls can't
    /// reach you, and you can't reach them. Call from an STA thread.
    /// </summary>
    static class Upnp
    {
        public static string LocalIp()
        {
            try
            {
                var nic = NetworkInterface.GetAllNetworkInterfaces()
                    .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                    .Select(n => n.GetIPProperties())
                    .FirstOrDefault(p => p.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork));
                var ip = nic?.UnicastAddresses.FirstOrDefault(a => a.Address.AddressFamily == AddressFamily.InterNetwork)?.Address;
                if (ip != null) return ip.ToString();
            }
            catch { }
            try
            {
                using (var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp))
                {
                    s.Connect("8.8.8.8", 53);
                    return ((IPEndPoint)s.LocalEndPoint).Address.ToString();
                }
            }
            catch { return null; }
        }

        /// <summary>Returns JSON: {"ok":true,"ip":"…","port":n} or {"ok":false,"error":"…"}.</summary>
        public static string Open(int port)
        {
            var json = new JavaScriptSerializer();
            var ip = LocalIp();
            try
            {
                var type = Type.GetTypeFromProgID("HNetCfg.NATUPnP");
                dynamic nat = Activator.CreateInstance(type);
                dynamic maps = null;
                // The router can take a few seconds to answer.
                for (int i = 0; i < 3 && maps == null; i++)
                {
                    maps = nat.StaticPortMappingCollection;
                    if (maps == null) Thread.Sleep(2000);
                }
                if (maps == null) return json.Serialize(new { ok = false, ip, port, error = "The router did not answer. UPnP may be turned off on it." });

                try { maps.Remove(port, "TCP"); } catch { }
                try
                {
                    maps.Add(port, "TCP", port, ip, true, "Nightjar (Soulseek)");
                    return json.Serialize(new { ok = true, ip, port });
                }
                catch (Exception add)
                {
                    // Some routers keep a mapping they won't let anyone replace. If it already points here, that's fine.
                    foreach (dynamic m in maps)
                    {
                        try
                        {
                            if ((int)m.ExternalPort == port && ((string)m.Protocol).Equals("TCP", StringComparison.OrdinalIgnoreCase))
                            {
                                if ((string)m.InternalClient == ip && (bool)m.Enabled) return json.Serialize(new { ok = true, ip, port, already = true });
                                return json.Serialize(new { ok = false, ip, port, error = "The router already forwards port " + port + " to another device (" + (string)m.InternalClient + "). Remove that rule in the router's settings, or forward it to " + ip + "." });
                            }
                        }
                        catch { }
                    }
                    return json.Serialize(new { ok = false, ip, port, error = add.Message });
                }
            }
            catch (Exception e)
            {
                return json.Serialize(new { ok = false, ip, port, error = e.Message });
            }
        }
    }
}
