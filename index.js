const functions = require("firebase-functions");
const admin = require("firebase-admin");
const serviceAccount = require("./reachedapp-64503-"+
    "firebase-adminsdk-d3gez-9229577938.json");
const {ServerValue} = require("firebase-admin").database;


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


exports.sendNotificationToTeacher = functions.database
    .ref("/Attendance/{date}/{classId}/Reported Absences" +
        "/{studentId}/TeacherNotified")
    .onCreate(async (snapshot, context) => {
      const classId = context.params.classId;
      const studentId = context.params.studentId;

      try {
        console.log(`Searching for teacher with classId: ${classId}`);
        const teachersSnapshot = await admin
            .database().ref(`/Teacher`).once("value");
        const teachers = teachersSnapshot.val();

        if (teachers) {
          const teacher = Object.values(teachers)
              .find((t) => t.classId === classId);
          const teacherToken = teacher.deviceToken;
          console.log(`Found teacher with device token: ${teacherToken}`);

          const payload = {
            notification: {
              title: "New Reported Absence",
              body: `Absence reported for student in your class(${studentId}).`,
              click_action: "FLUTTER_NOTIFICATION_CLICK",
            },
          };

          await admin.messaging().sendToDevice(teacherToken, payload);
          console.log("Notification sent successfully");

          // set TeacherNotified to true
          await snapshot.ref.set(true);
          console.log("TeacherNotified set to true");

          // update the timestamp
          await snapshot.ref.parent.child(`TeacherNotifiedTimeStamp`)
              .set(ServerValue.TIMESTAMP);
        } else {
          console.log("Teacher not found");
        }
      } catch (error) {
        console.error(`Error sending notification: ${error}`);
        return Promise.reject(error);
      }
    });


