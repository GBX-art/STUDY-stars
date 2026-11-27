// Study Stars - online accounts (Firebase). Loaded by index.html as a module.
// If this file or Firebase can't load, the app keeps working offline.
const SS = window.SS;
const V = '10.12.2', B = `https://www.gstatic.com/firebasejs/${V}/`;
const cfg = {
  apiKey: "AIzaSyBtKXJH3HVfrxasCJN8_d5dTRgdtbjy0P4",
  authDomain: "study-stars-cb78f.firebaseapp.com",
  projectId: "study-stars-cb78f",
  storageBucket: "study-stars-cb78f.firebasestorage.app",
  messagingSenderId: "194416058619",
  appId: "1:194416058619:web:d0acf8005ea5003c8f105e"
};

let App, A, F;
try {
  [App, A, F] = await Promise.all(['app', 'auth', 'firestore'].map(n => import(`${B}firebase-${n}.js`)));
} catch (e) { SS.failed(); throw e; }

const app = App.initializeApp(cfg);
const auth = A.getAuth(app);
let db;
try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
catch (e) { db = F.getFirestore(app); }

let unsubs = [], pendingName = '', myBoard = null, bref = null, wref = null, myWallet = null, walletMade = false;

// Shape a session/red star exactly the way the security rules expect.
function clean(x, src) {
  const label = String(x.label || '').slice(0, 60), end = Math.round(x.end);
  if (x.kind === 'r') return { id: String(x.id), kind: 'r', end, label, src };
  const min = Math.min(240, Math.max(1, Math.round(x.min || 1)));
  return { id: String(x.id), kind: 's', mode: x.mode === 'check' ? 'check' : 'timer', start: end - min * 60000, end, min, label, src };
}
const sref = (uid, id) => F.doc(db, 'users', uid, 'sessions', String(id));

// First sign-in: create the profile and bring in stars from offline use.
async function ensureUser(u) {
  const ref = F.doc(db, 'users', u.uid);
  const s = await F.getDoc(ref);
  if (s.exists()) return { data: s.data(), fresh: 0 };
  const name = (pendingName || u.displayName || (u.email || 'Student').split('@')[0]).trim().slice(0, 30) || 'Student';
  const photo = (u.photoURL || '').length <= 150000 ? (u.photoURL || '') : '';
  const local = SS.offline();
  await F.setDoc(ref, { name, photo, created: F.serverTimestamp(), imported: local.length });
  let moved = 0;
  try {
    for (let i = 0; i < local.length; i += 400) {
      const b = F.writeBatch(db);
      local.slice(i, i + 400).forEach(x => b.set(sref(u.uid, x.id), clean(x, 'import')));
      await b.commit(); moved += Math.min(400, local.length - i);
    }
    if (moved) SS.clearOffline();
  } catch (e) { SS.note('Some offline stars could not be moved to your account (' + (e.code || e.message) + ').'); }
  return { data: { name, photo }, fresh: moved };
}

window.SScloud = {
  google: async () => {
    try { return await A.signInWithPopup(auth, new A.GoogleAuthProvider()); }
    catch (e) { if (e.code === 'auth/popup-blocked') return A.signInWithRedirect(auth, new A.GoogleAuthProvider()); throw e; }
  },
  emailIn: (e, p) => A.signInWithEmailAndPassword(auth, e, p),
  emailUp: async (e, p, n) => {
    pendingName = n;
    const c = await A.createUserWithEmailAndPassword(auth, e, p);
    try { await A.updateProfile(c.user, { displayName: n }); } catch (x) {}
    return c;
  },
  reset: e => A.sendPasswordResetEmail(auth, e),
  out: () => A.signOut(auth),
  saveProfile: async (name, photo) => {
    const uid = auth.currentUser.uid, b = F.writeBatch(db);
    b.set(F.doc(db, 'users', uid), { name, photo }, { merge: true });
    if (myBoard) b.update(F.doc(db, 'board', uid), { name, photo: photo.length <= 60000 ? photo : '' });
    return b.commit();
  },
  // Market: claim a free item (price 0) or buy one. The rules check level and price.
  addItem: (id, price) => F.updateDoc(wref, { owned: [...myWallet.owned, id], aca: myWallet.aca - price, last: id }),
  equip: (weapon, armour) => F.updateDoc(wref, { weapon, armour })
};

// Leaderboard entry for this user. `imp` = stars from before joining (count for level only).
async function ensureBoard(uid, prof, docs) {
  const s = await F.getDoc(bref);
  if (s.exists()) return;
  const imp = Math.round(docs.filter(x => x.kind !== 'r').reduce((a, x) => a + (+x.min || 0), 0));
  await F.setDoc(bref, { name: prof.name, photo: (prof.photo || '').length <= 60000 ? (prof.photo || '') : '',
    min: 0, hours: {}, imp, lastEnd: Date.now(), last: '' });
}
let pruned = false;
function pruneHours() {
  if (pruned || !myBoard || !myBoard.hours) return;
  const cut = Math.floor(Date.now() / 3600000) - 200, keep = {};
  let drop = false;
  for (const k in myBoard.hours) { if (+k >= cut) keep[k] = myBoard.hours[k]; else drop = true; }
  pruned = true;
  if (drop) F.updateDoc(bref, { hours: keep }).catch(() => {});
}
SS.ready();

A.onAuthStateChanged(auth, async u => {
  unsubs.forEach(f => f()); unsubs = []; myBoard = null; pruned = false; myWallet = null; walletMade = false;
  if (!u) { SS.signedOut(); return; }
  bref = F.doc(db, 'board', u.uid); wref = F.doc(db, 'wallet', u.uid);
  try {
    const { data, fresh } = await ensureUser(u);
    pendingName = '';
    SS.store.push = async x => {
      const c = clean(x, 'online'), r = sref(u.uid, x.id);
      if (c.kind === 's') {
        if (!myBoard) SS.lb('Saved, but your leaderboard entry wasn’t ready, so this session wasn’t counted. Reload the app.', 0);
        else {
          // Minutes not already counted (a session that overlaps the last counted one adds only its new part).
          const add = c.start >= myBoard.lastEnd ? c.min : Math.floor((c.end - myBoard.lastEnd) / 60000);
          if (add <= 0) SS.lb('Saved, but this time was already counted on the leaderboard.', 0);
          else {
            const k = String(Math.floor(c.end / 3600000)), b = F.writeBatch(db);
            b.set(r, c);
            b.update(bref, new F.FieldPath('hours', k), ((myBoard.hours || {})[k] || 0) + add,
              'min', (myBoard.min || 0) + add, 'lastEnd', c.end, 'last', c.id);
            try { await b.commit(); SS.lb(`+${add} min added to the leaderboard.`, 1); return; }
            catch (e) { SS.lb('Saved, but it couldn’t be counted on the leaderboard (' + (e.code || e.message) + '). Please send Claude a screenshot of this.', 0); }
          }
        }
      }
      try { await F.setDoc(r, c); }
      catch (e) { SS.note('Couldn’t save that to your account (' + e.code + '). Check your internet.'); }
    };
    SS.store.del = id => F.deleteDoc(sref(u.uid, id)).catch(() => {});
    SS.signedIn({ uid: u.uid, name: data.name, photo: data.photo || '', email: u.email || '' });
    if (fresh) SS.banner(`Welcome! ${fresh} offline session${fresh > 1 ? 's were' : ' was'} added to your account.`);
    let boardChecked = false;
    unsubs.push(F.onSnapshot(F.collection(db, 'users', u.uid, 'sessions'), s => {
      const docs = s.docs.map(d => d.data());
      SS.setItems(docs);
      if (!boardChecked) {
        boardChecked = true;
        ensureBoard(u.uid, data, docs).catch(e => { boardChecked = false; SS.lb('Couldn’t join the leaderboard (' + (e.code || e.message) + ').', 0); });
      }
    }, e => SS.note('Sync stopped (' + e.code + '). Reload the app to try again.')));
    unsubs.push(F.onSnapshot(bref, s => { myBoard = s.exists() ? s.data() : null; pruneHours(); }, () => {}));
    unsubs.push(F.onSnapshot(wref, s => {
      if (!s.exists()) {
        if (!walletMade) {
          walletMade = true;
          F.setDoc(wref, { aca: 0, owned: [], weapon: '', armour: '', last: '' })
            .catch(e => { walletMade = false; SS.note('The market couldn’t open (' + (e.code || e.message) + ').'); });
        }
        return;
      }
      myWallet = s.data(); SS.wallet(myWallet);
    }, e => SS.note('The market couldn’t load (' + e.code + ').')));
    unsubs.push(F.onSnapshot(F.query(F.collection(db, 'board'), F.limit(500)),
      s => SS.board(s.docs.map(d => Object.assign({ id: d.id }, d.data()))),
      e => SS.note('Leaderboard couldn’t load (' + e.code + ').')));
  } catch (e) {
    SS.note('Signed in, but your account couldn’t load (' + (e.code || e.message) + '). Check your internet and reload.');
  }
});
