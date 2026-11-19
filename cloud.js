// cloud.js — ชั้นซิงก์ข้อมูลของ "บ้าน" ผ่าน Firebase Firestore
// โครงข้อมูล: homes/{รหัสบ้าน}/{ชื่อแอป}_{คอลเลกชัน}/{id}  → ใช้โปรเจกต์ MooData ร่วมกับแอปอื่นได้
const firebaseConfig = {
  apiKey: "AIzaSyCIJwoL-vHhlkWbgyCLpWQs7U5aTmozui4",
  authDomain: "moodata-c37f8.firebaseapp.com",
  projectId: "moodata-c37f8",
  storageBucket: "moodata-c37f8.firebasestorage.app",
  messagingSenderId: "1062297046934",
  appId: "1:1062297046934:web:8d5dd0078345fe935757b7"
};
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const APP = 'kinraidee';
const params = new URLSearchParams(location.search);
const MOCK = params.has('mock');

let impl = null, home = null, unsubs = [];
const pathOf = c => `homes/${home}/${APP}_${c}`;
const plain = o => JSON.parse(JSON.stringify(o)); // ตัด undefined ออก (Firestore ไม่รับ)
function err(e) { console.warn('[cloud]', e); window.App && App.cloudError(e); }

/* ---------- Firebase จริง ---------- */
async function realImpl() {
  const [appMod, authMod, fs] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) { db = fs.getFirestore(app); }
  const colRef = c => fs.collection(db, 'homes', home, `${APP}_${c}`);
  const sessRef = () => fs.doc(db, 'homes', home, `${APP}_meta`, 'swipe');
  return {
    async auth() {
      await new Promise(r => { const off = authMod.onAuthStateChanged(auth, () => { off(); r(); }); });
      if (auth.currentUser) return auth.currentUser.uid;
      const cred = await authMod.signInAnonymously(auth);
      return cred.user.uid;
    },
    listen(c, cb) {
      const q = c === 'history' ? fs.query(colRef(c), fs.orderBy('ts', 'desc'), fs.limit(300)) : colRef(c);
      return fs.onSnapshot(q, s => cb(s.docs.map(d => d.data()), { fromCache: s.metadata.fromCache }), err);
    },
    listenSession(cb) { return fs.onSnapshot(sessRef(), d => cb(d.exists() ? d.data() : null), err); },
    put: (c, id, d) => fs.setDoc(fs.doc(colRef(c), id), d),
    del: (c, id) => fs.deleteDoc(fs.doc(colRef(c), id)),
    async bulk(c, arr) {
      for (let i = 0; i < arr.length; i += 400) {
        const b = fs.writeBatch(db);
        arr.slice(i, i + 400).forEach(o => b.set(fs.doc(colRef(c), o.id), o));
        b.commit().catch(err); // ไม่ await: ออฟไลน์จะค้างจนกว่าจะต่อเน็ต
      }
    },
    setSession: d => fs.setDoc(sessRef(), d),
    updatePlayer: (u, o) => fs.updateDoc(sessRef(), { ['players.' + u]: o }),
    setIfAbsent: (f, v) => fs.runTransaction(db, async t => {
      const d = await t.get(sessRef());
      if (!d.exists() || d.data()[f]) return;
      t.update(sessRef(), { [f]: v });
    })
  };
}

/* ---------- โหมดจำลอง (?mock&dev=A) ไว้ทดสอบสองเครื่องในเบราว์เซอร์เดียว ---------- */
function mockImpl() {
  const K = 'mockcloud', dev = params.get('dev') || 'X', subs = new Set();
  const read = () => { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch (e) { return {}; } };
  const write = st => { localStorage.setItem(K, JSON.stringify(st)); setTimeout(() => subs.forEach(f => f()), 0); };
  addEventListener('storage', e => { if (e.key === K) subs.forEach(f => f()); });
  const sk = () => pathOf('meta') + '/swipe';
  const sub = f => { subs.add(f); f(); return () => subs.delete(f); };
  return {
    auth: async () => 'mock-' + dev,
    listen(c, cb) {
      return sub(() => {
        const st = read(), pre = pathOf(c) + '/';
        const arr = Object.keys(st).filter(k => k.startsWith(pre)).map(k => st[k]);
        if (c === 'history') arr.sort((a, b) => b.ts - a.ts);
        cb(arr, { fromCache: false });
      });
    },
    listenSession: cb => sub(() => cb(read()[sk()] || null)),
    put(c, id, d) { const st = read(); st[pathOf(c) + '/' + id] = plain(d); write(st); return Promise.resolve(); },
    del(c, id) { const st = read(); delete st[pathOf(c) + '/' + id]; write(st); return Promise.resolve(); },
    bulk(c, arr) { const st = read(); arr.forEach(o => st[pathOf(c) + '/' + o.id] = plain(o)); write(st); return Promise.resolve(); },
    setSession(d) { const st = read(); st[sk()] = plain(d); write(st); return Promise.resolve(); },
    updatePlayer(u, o) { const st = read(); if (st[sk()]) { st[sk()].players = st[sk()].players || {}; st[sk()].players[u] = plain(o); } write(st); return Promise.resolve(); },
    setIfAbsent(f, v) { const st = read(); if (st[sk()] && !st[sk()][f]) { st[sk()][f] = plain(v); write(st); } return Promise.resolve(); }
  };
}

/* ---------- API ที่แอปเรียกใช้ ---------- */
const Cloud = {
  uid: null,
  get home() { return home; },
  async start(code, opts = {}) {
    try {
      if (!impl) impl = MOCK ? mockImpl() : await realImpl();
      if (!this.uid) this.uid = await impl.auth();
    } catch (e) { err(e); return false; }
    this.stop();
    home = code;
    if (opts.upload) for (const c of ['dishes', 'places', 'history']) impl.bulk(c, plain(opts.upload[c] || []));
    for (const c of ['dishes', 'places', 'history']) unsubs.push(impl.listen(c, (a, m) => App.remote(c, a, m)));
    unsubs.push(impl.listenSession(s => App.remoteSession(s)));
    return true;
  },
  stop() { unsubs.forEach(f => { try { f(); } catch (e) {} }); unsubs = []; home = null; },
  put(c, id, d) { if (home) Promise.resolve(impl.put(c, id, plain(d))).catch(err); },
  del(c, id) { if (home) Promise.resolve(impl.del(c, id)).catch(err); },
  bulk(c, arr) { if (home) impl.bulk(c, plain(arr)); },
  setSession(d) { if (home) Promise.resolve(impl.setSession(plain(d))).catch(err); },
  updatePlayer(u, o) { if (home) Promise.resolve(impl.updatePlayer(u, plain(o))).catch(err); },
  setIfAbsent(f, v) { if (home) Promise.resolve(impl.setIfAbsent(f, plain(v))).catch(e => console.warn('[cloud] setIfAbsent', e)); }
};
window.Cloud = Cloud;
window.dispatchEvent(new Event('cloud-ready'));
