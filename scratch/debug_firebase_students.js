const FirebaseService = require('../services/firebaseService');

async function debugFirebaseStudents() {
  console.log('🔍 Pulling live students from Firebase Firestore...');
  const res = await FirebaseService.pullFromFirebase();
  if (res.success && res.data) {
    console.log('--- FIREBASE STUDENTS ---');
    console.log(JSON.stringify(res.data.students, null, 2));
    console.log('-------------------------');
  } else {
    console.log('Failed to pull from Firebase:', res);
  }
}

debugFirebaseStudents();
