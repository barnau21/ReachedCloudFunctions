const functions = require("firebase-functions");
const admin = require("firebase-admin");

const {SecretManagerServiceClient} = require("@google-cloud/secret-manager");
const client = new SecretManagerServiceClient();
const name = "projects/reachedapp-64503/secrets/reached-cloud-credentials" +
"/versions/1";

/**
 * gets credentials from google secret
 */
async function getSecret() {
  const [version] = await client.accessSecretVersion({name});
  const credentials = JSON.parse(version.payload.data.toString());
  return credentials;
}

/**
 * initializes app
 */
async function initializeApp() {
  const credentials = await getSecret();
  admin.initializeApp({
    credential: admin.credential.cert(credentials),
    databaseURL: "https://reachedapp-64503-default-rtdb.firebaseio.com",
  });
  database = admin.database();
}

/**
 * main
 */
async function main() {
  return await initializeApp();
}

let database = null;
main();

exports.testSecretManager = async (req, res) => {
  const [version] = await client.accessSecretVersion({name});
  const payload = version.payload.data.toString();
  console.debug(`Payload: ${payload}`);
  res.sendStatus(200);
};

exports.sendAbsenceNotification = functions
    .database.ref("/Attendance/{attendanceDate}/{classId}/IsSubmitted")
    .onWrite(async (change, context) => {
      functions.logger.debug("Function triggered:", context.params);
      const attendanceDate = context.params.attendanceDate;
      const classId = context.params.classId;
      functions.logger.debug("IsSubmitted: " + JSON.stringify(change));

      // Check if the attendance status has been submitted
      if (change.after.val() === true && change.before.val() === null) {
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

          // get the current date and time
          const currentDate = new Date();
          const currentTime = currentDate.toLocaleString();
          // update the timestamp
          await snapshot.ref.parent.child(`TeacherNotifiedTimeStamp`)
              .set(currentTime);
        } else {
          console.log("Teacher not found");
        }
      } catch (error) {
        console.error(`Error sending notification: ${error}`);
        return Promise.reject(error);
      }
    });

exports.sendNotificationOnNewMessage = functions.database
    .ref("/Messaging/{convoId}/{messageId}")
    .onCreate(async (snapshot, context) => {
      const convoId = context.params.convoId;

      const messageData = snapshot.val();
      console.log(`Message data: ${JSON.stringify(messageData)}`);
      const senderId = messageData.senderId;
      const senderName = messageData.senderName;

      // Extract the receiver's ID from the convoId
      const receiverId = convoId.replace(senderId, "");

      // Determine if the receiver is a Teacher or Parent
      const userType = receiverId.startsWith("T") ? "Teacher" : "Parent";

      // Find the user device tokens in the database to send notifications
      const deviceTokenSnapshot = await admin.database()
          .ref(`/${userType}/${receiverId}/deviceToken`).once("value");
      const deviceToken = deviceTokenSnapshot.val();

      // Customize the notification payload
      const payload = {
        notification: {
          title: `New message from ${senderName}`,
          body: messageData.message,
        },
      };

      // Send the notification to the receiver's device
      return admin.messaging().sendToDevice(deviceToken, payload);
    });


