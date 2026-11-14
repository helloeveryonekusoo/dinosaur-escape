// Network for the 3-player race: peer-to-peer data channels (WebRTC) set up through PeerJS.
// The public PeerJS server only introduces the browsers to each other (it sees the room code); game data then goes
// directly between the players. The library is loaded only when someone opens the race lobby, so single-player
// games never contact it.
(function () {
  const DG = window.DG;
  const LIB = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const PREFIX = 'dinoesc-v1-';                       // room code -> PeerJS id of the host
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no I/O/0/1, which are easy to mix up
  let peer = null, isHost = false, hostConn = null, onEv = () => { }, closing = false;
  const conns = new Map();                            // host: peer id -> connection

  function loadLib() {
    return new Promise((res, rej) => {
      if (window.Peer) return res();
      const s = document.createElement('script'); s.src = LIB; s.async = true;
      s.onload = () => window.Peer ? res() : rej(new Error('lib'));
      s.onerror = () => rej(new Error('lib'));
      document.head.appendChild(s);
    });
  }
  const randCode = () => { let c = ''; for (let i = 0; i < 5; i++) c += ALPHA[Math.floor(Math.random() * ALPHA.length)]; return c; };
  function openPeer(id) {
    return new Promise((res, rej) => {
      let opened = false;
      const p = id ? new window.Peer(id, { debug: 0 }) : new window.Peer({ debug: 0 });
      const to = setTimeout(() => { if (!opened) { try { p.destroy(); } catch (e) { } rej({ type: 'timeout' }); } }, 15000);
      p.on('open', () => { opened = true; clearTimeout(to); res(p); });
      p.on('error', e => { if (!opened) { clearTimeout(to); try { p.destroy(); } catch (er) { } rej(e); } else onEv('error', e); });
      p.on('disconnected', () => { if (opened && !p.destroyed) { try { p.reconnect(); } catch (e) { } } }); // lost the broker only; data channels stay up
    });
  }
  function wire(c) {
    c.on('data', d => onEv('msg', c.peer, d));
    c.on('close', () => { conns.delete(c.peer); if (c === hostConn) hostConn = null; if (!closing) onEv('leave', c.peer); });
    c.on('error', () => { });
  }

  DG.Net = {
    get isHost() { return isHost; },
    get connected() { return !!peer; },
    on(fn) { onEv = fn; },
    // create a room; resolves with its code
    async host() {
      await loadLib(); DG.Net.close(); isHost = true;
      for (let i = 0; i < 4; i++) {
        const code = randCode();
        try { peer = await openPeer(PREFIX + code); }
        catch (e) { if (e && e.type === 'unavailable-id') continue; throw e; }
        peer.on('connection', c => {
          c.on('open', () => { conns.set(c.peer, c); wire(c); onEv('join', c.peer); });
        });
        return code;
      }
      throw { type: 'unavailable-id' };
    },
    // join the room with this code
    async join(code) {
      await loadLib(); DG.Net.close(); isHost = false;
      peer = await openPeer(null);
      return new Promise((res, rej) => {
        let ok = false;
        const c = peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
        const to = setTimeout(() => { if (!ok) rej({ type: 'peer-unavailable' }); }, 12000);
        peer.on('error', e => { if (!ok) { clearTimeout(to); rej(e); } });
        c.on('open', () => { ok = true; clearTimeout(to); hostConn = c; wire(c); res(); });
      });
    },
    // guest -> host, or host -> one guest (to = peer id)
    send(msg, to) {
      if (isHost) { const c = conns.get(to); if (c && c.open) c.send(msg); }
      else if (hostConn && hostConn.open) hostConn.send(msg);
    },
    // host -> every guest
    broadcast(msg) { if (!isHost) return; conns.forEach(c => { if (c.open) c.send(msg); }); },
    kick(id) { const c = conns.get(id); if (c) { try { c.close(); } catch (e) { } conns.delete(id); } },
    close() { // our own leaving: no 'leave' events for the connections we close here
      closing = true;
      conns.forEach(c => { try { c.close(); } catch (e) { } }); conns.clear();
      if (hostConn) { try { hostConn.close(); } catch (e) { } hostConn = null; }
      if (peer) { try { peer.destroy(); } catch (e) { } peer = null; }
      isHost = false;
      setTimeout(() => { closing = false; }, 0);
    },
    // a human-readable reason for a PeerJS error
    why(e) {
      const t = e && e.type;
      if (t === 'peer-unavailable') return '部屋が見つかりません（コードを確認してください）';
      if (t === 'timeout') return '接続に時間がかかりすぎました';
      if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return '接続サーバーにつながりません';
      if (t === 'browser-incompatible' || t === 'webrtc') return 'このブラウザはネット対戦に対応していません';
      if (e && e.message === 'lib') return '通信ライブラリを読み込めませんでした（ネット接続を確認してください）';
      return '接続に失敗しました' + (t ? `（${t}）` : '');
    }
  };
})();
