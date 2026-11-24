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

let unsub = null, pendingName = '';

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
  saveProfile: (name, photo) => F.setDoc(F.doc(db, 'users', auth.currentUser.uid), { name, photo }, { merge: true })
};
SS.ready();

A.onAuthStateChanged(auth, async u => {
  if (unsub) { unsub(); unsub = null; }
  if (!u) { SS.signedOut(); return; }
  try {
    const { data, fresh } = await ensureUser(u);
    pendingName = '';
    SS.store.push = x => F.setDoc(sref(u.uid, x.id), clean(x, 'online'))
      .catch(e => SS.note('Couldn’t save that to your account (' + e.code + '). Check your internet.'));
    SS.store.del = id => F.deleteDoc(sref(u.uid, id)).catch(() => {});
    SS.signedIn({ uid: u.uid, name: data.name, photo: data.photo || '', email: u.email || '' });
    if (fresh) SS.banner(`Welcome! ${fresh} offline session${fresh > 1 ? 's were' : ' was'} added to your account.`);
    unsub = F.onSnapshot(F.collection(db, 'users', u.uid, 'sessions'),
      s => SS.setItems(s.docs.map(d => d.data())),
      e => SS.note('Sync stopped (' + e.code + '). Reload the app to try again.'));
  } catch (e) {
    SS.note('Signed in, but your account couldn’t load (' + (e.code || e.message) + '). Check your internet and reload.');
  }
});
