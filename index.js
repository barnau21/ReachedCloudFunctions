const functions = require("firebase-functions");
const admin = require("firebase-admin");
const serviceAccount = require("./reachedapp-64503-"+
    "firebase-adminsdk-d3gez-9229577938.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://reachedapp-64503-default-rtdb.firebaseio.com",
});

const database = admin.database();

exports.sendAbsenceNotification = functions
    .database.ref("/Attendance/{attendanceDate}/{classId}/IsSubmitted")
    .onWrite(async (change, context) => {
      functions.logger.debug("Function triggered:", context.params);
      const attendanceDate = context.params.attendanceDate;
      const classId = context.params.classId;
      functions.logger.debug("IsSubmitted: " + JSON.stringify(change));

      // Check if the attendance status has been submitted
      if (change.after.val() === true && change.before.val() === false) {
        // Retrieve the absent students' information
        const absStudentsSnap = await database
            .ref(`/Attendance/${attendanceDate}/${classId}`)
            .orderByChild("IsPresent")
            .equalTo(false).once("value");

        if (absStudentsSnap.exists()) {
          functions.logger.debug("Absent:", absStudentsSnap.val());
        } else {
          functions.logger.debug("Absent: No data");
        }

        // Iterate through the absent students and send notifications to parents
        for (const studentId in absStudentsSnap.val()) {
          if (Object.prototype
              .hasOwnProperty
              .call(absStudentsSnap.val(), studentId)) {
            const studentSnapshot = await database
                .ref(`/Student/${studentId}`)
                .once("value");

            functions.logger.debug("Student snapshot:", studentSnapshot.val());

            const parentId = studentSnapshot.val().parentId;

            // Retrieve the parent's device token
            const parentSnapshot = await database
                .ref(`/Parent/${parentId}`)
                .once("value");
            const deviceToken = parentSnapshot.val().deviceToken;

            // Define the notification payload
            const payload = {
              notification: {
                title: "Absence Alert",
                body: `Your child, ${studentSnapshot
                    .val().name}, was marked absent on ${attendanceDate}.`,
              },
            };

            // Send the notification
            try {
              const response = await admin.messaging()
                  .sendToDevice(deviceToken, payload);
              functions.logger.debug("FCM response:", response);
              functions.logger.debug("Device token", deviceToken);
              functions.logger.debug("Payload: ", payload);
              functions.logger.debug("Notification sent success:", parentId);
            } catch (error) {
              functions.logger.error("Error sending notification:", error);
            }
          }
        }
      }
    });


exports.testNotification = functions.https.onRequest(async (req, res) => {
  // Replace this with a known valid device token for testing
  const deviceToken = "eJrbyVGLSkOxm9kZ2iz282:APA" +
  "91bFrknUxHc54e0NkyaUS3x5vmTOTMvletQKIhGHQzlL87VCljSXM9R" +
  "av47onQQ_R2E8oi_PegMzn8WYPRMRXwPWFSe4Zlsj0ebTlOeq57WRHPq" +
  "LopH6KhhOxNgNFf0nQyujCo0pG";


  const payload = {
    notification: {
      title: "Test Notification",
      body: "This is a test notification from Firebase Cloud Function.",
    },
  };

  try {
    const response = await admin.messaging().sendToDevice(deviceToken, payload);
    console.log("FCM response:", response);

    if (response.results && response.results[0].error) {
      console.error("Error:", response.results[0].error);
      res.status(500).send("Error: " + response.results[0].error);
    } else {
      console.log("Test notification sent successfully");
      res.status(200).send("Test notification sent successfully");
    }
  } catch (error) {
    console.error("Error sending test notification:", error);

    // Send a custom response despite the error
    res.status(200).send("attempt finished with an error: " + error);
  }
});

