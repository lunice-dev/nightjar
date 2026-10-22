import { useEffect, useMemo, useState } from 'react';
import type { ChatMessage } from '../api/types';
import { Composer, MessageList, type Line } from '../components/Chat';
import { Icon } from '../components/Icon';
import { usePrefs } from '../prefs';
import { useStore } from '../store';

export function MessagesScreen() {
  const conversations = useStore((s) => s.conversations);
  const chatWith = useStore((s) => s.chatWith);
  const message = useStore((s) => s.message);
  const ignored = usePrefs((s) => s.ignored);
  const [start, setStart] = useState('');

  const list = useMemo(() => {
    const items = conversations.filter((c) => !ignored.includes(c.username) || c.username === chatWith);
    // Someone you've just chosen to message shows up before the first message is sent.
    if (chatWith && !items.some((c) => c.username === chatWith)) {
      items.unshift({ username: chatWith, isActive: true, unAcknowledgedMessageCount: 0, messages: [] });
    }
    const last = (c: (typeof items)[number]) => c.messages?.[c.messages.length - 1]?.timestamp ?? '9';
    return items.sort((a, b) => last(b).localeCompare(last(a)));
  }, [conversations, chatWith, ignored]);

  return (
    <div className="split">
      <aside className={`split-list ${chatWith ? 'has-open' : ''}`} aria-label="Conversations">
        <form
          className="start-chat"
          onSubmit={(e) => {
            e.preventDefault();
            if (start.trim()) {
              message(start.trim());
              setStart('');
            }
          }}
        >
          <label htmlFor="start-chat" className="sr-only">
            Username to message
          </label>
          <input id="start-chat" className="input" placeholder="Message someone…" value={start} onChange={(e) => setStart(e.target.value)} />
        </form>
        {list.length === 0 && <p className="hint-text pad">No conversations yet. Type a username above, or choose Message on someone’s profile.</p>}
        <ul className="convos">
          {list.map((c) => {
            const last = c.messages?.[c.messages.length - 1];
            return (
              <li key={c.username}>
                <button className="convo" aria-current={chatWith === c.username} onClick={() => message(c.username)}>
                  <span className="convo-name">{c.username}</span>
                  {c.unAcknowledgedMessageCount > 0 && <span className="badge">{c.unAcknowledgedMessageCount}</span>}
                  <span className="convo-last">{last ? `${last.direction === 'Out' ? 'You: ' : ''}${last.message}` : 'New conversation'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <section className="split-main">{chatWith ? <Thread key={chatWith} username={chatWith} /> : <NoThread />}</section>
    </div>
  );
}

function NoThread() {
  return (
    <div className="empty pad">
      <h2>Private messages</h2>
      <p>Pick a conversation, or start one from someone’s profile. It’s polite to say hello before queueing a lot from one person.</p>
    </div>
  );
}

function Thread({ username }: { username: string }) {
  const backend = useStore((s) => s.backend);
  const browse = useStore((s) => s.browse);
  const refresh = useStore((s) => s.refreshConversations);
  const toast = useStore((s) => s.toast);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!backend) return;
    let alive = true;
    const load = async () => {
      try {
        const m = await backend.messages(username);
        if (!alive) return;
        setMessages(m);
        if (m.some((x) => x.direction === 'In' && !x.isAcknowledged)) {
          await backend.markRead(username);
          refresh();
        }
      } catch {
        if (alive) setMessages((m) => m);
      }
    };
    load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [backend, username, refresh]);

  const lines: Line[] = messages.map((m, i) => ({
    key: `${m.id ?? i}-${m.timestamp}`,
    username: m.username,
    text: m.message,
    timestamp: m.timestamp,
    mine: m.direction === 'Out',
  }));

  return (
    <div className="thread">
      <header className="thread-head">
        <button className="icon-btn back" aria-label="Back to conversations" onClick={() => useStore.setState({ chatWith: undefined })}>
          <Icon name="chevron" size={18} />
        </button>
        <h1 className="thread-title">{username}</h1>
        <button className="btn quiet small" onClick={() => browse(username)}>
          <Icon name="person" size={16} /> Profile and shares
        </button>
        <button
          className="btn quiet small"
          onClick={async () => {
            await backend?.closeConversation(username);
            useStore.setState({ chatWith: undefined });
            refresh();
          }}
        >
          Close
        </button>
      </header>
      <MessageList lines={lines} showNames={false} empty={`Say hello to ${username}.`} />
      <Composer
        placeholder={`Message ${username}`}
        onSend={async (t) => {
          try {
            await backend?.sendMessage(username, t);
            setMessages(await backend!.messages(username));
            refresh();
          } catch (e) {
            const status = (e as { status?: number }).status;
            toast(status === 404 ? `${username} is offline. They’ll get it when they’re back.` : `Message not sent: ${(e as Error).message}`, 'error');
            throw e;
          }
        }}
      />
    </div>
  );
}
