const express = require("express");
const multer = require("multer");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const unzipper = require("unzipper");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Multer (IMPORTANT)
const upload = multer({
  storage: multer.memoryStorage()
});

// ✅ Firebase Admin Init
require('dotenv').config();
const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT);
const BASE_URL = process.env.BASE_URL;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "sindhu-online-exam.firebasestorage.app"
});

const bucket = admin.storage().bucket();
const db = admin.firestore();

console.log("Using bucket:", bucket.name);


function findIndexFile(basePath) {
  console.log("Entered findIndexfile");
  const files = fs.readdirSync(basePath);
  console.log("files iteration", files);
  for (let file of files) {
    const fullPath = path.join(basePath, file);
    console.log("fullpath", fullPath);
    // If file is index.html (case insensitive)
    if (file.toLowerCase() === "index.html") {
      return fullPath;
    }
    // If folder → search inside
    if (fs.lstatSync(fullPath).isDirectory()) {
      const result = findIndexFile(fullPath);
      console.log("iteration in sub folders");
      if (result) return result;
    }
  }
  console.log("File not found in findindexfile iteration");
  return null;
}

/*-------------CREATE NEW PROJECT------------------ */
app.post("/create-project", async (req, res) => {
  try {
    const { title, description, members, createdBy } = req.body;

    if (!title || !members || members.length === 0) {
      return res.status(400).send("Invalid project data");
    }

    const counterRef = db.collection("meta").doc("projectCounter");
    const projectRef = db.collection("projects");

    let newProjectId = "";

    // ✅ Transaction to safely increment counter
    await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);

      let count = 1000;

      if (counterDoc.exists) {
        count = counterDoc.data().count;
      }

      count++;

      newProjectId = "P" + count;

      // ✅ Update counter
      transaction.set(counterRef, { count });

      // ✅ Create new project
      transaction.set(projectRef.doc(newProjectId), {
        projectId: newProjectId,
        title: title,
        description: description || "",
        members: members, // array of emails
        createdBy: createdBy || "",
        status: "created",
        zipUrl: "",
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    res.send({
      success: true,
      projectId: newProjectId
    });

  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating project");
  }
});

// ==========================================
// ✅ UPLOAD + SAVE + EXTRACT
// ==========================================
app.post("/upload/:projectId", upload.single("file"), async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const file = req.file;

    if (!file) {
      return res.status(400).send("No file uploaded");
    }

    console.log("Original file size:", file.size);
    console.log("Buffer exists:", !!file.buffer);

    const fileName = `zips/${projectId}.zip`;
    const fileUpload = bucket.file(fileName);

    // ✅ Upload (SAFE METHOD)
    await fileUpload.save(file.buffer, {
      metadata: {
        contentType: file.mimetype
      }
    });

    // ✅ Make public
    await fileUpload.makePublic();

    const zipUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    const previewUrl =

      console.log("ZIP URL:", zipUrl);

    // ✅ Save in Firestore
    await db.collection("projects").doc(projectId).set({
      projectId,
      zipUrl: zipUrl,
      status: "uploaded",
      updatedAt: new Date()
    }, { merge: true });

    // ✅ Extract ZIP
    const extractPath = path.join(__dirname, "projects", projectId);
    await extractZipFile(zipUrl, projectId, extractPath);

    res.send({
      success: true,
      zipUrl
    });

  } catch (error) {
    console.error(error);
    res.status(500).send(error.message);
  }
});


// ==========================================
// ✅ DOWNLOAD + EXTRACT FUNCTION
// ==========================================
async function extractZipFile(zipUrl, projectId, extractPath) {
  console.log("Entered extractzipfile function");
  const zipPath = path.join(__dirname, "temp", `${projectId}.zip`);

  // ✅ Ensure folders exist
  if (!fs.existsSync("temp")) {
    fs.mkdirSync("temp");
  }

  if (!fs.existsSync(extractPath)) {
    fs.mkdirSync(extractPath, { recursive: true });
  }

  console.log("Downloading ZIP...");

  // ✅ Download FULL file
  const response = await axios.get(zipUrl, {
    responseType: "arraybuffer"
  });

  fs.writeFileSync(zipPath, response.data);

  console.log("Downloaded size:", fs.statSync(zipPath).size);

  // ✅ Extract ZIP
  await fs.createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: extractPath }))
    .promise();

  console.log("Extraction complete");

  // ✅ Optional: delete zip after extraction
  fs.unlinkSync(zipPath);
}


app.use('/preview', express.static(path.join(__dirname, 'projects')));

/* ------------------- Preview Link -------------------*/
app.get("/preview/:projectId/", async(req, res) => {
  try {
    console.log("Entered preview mode for project ", req.params.projectId);
    const projectId = req.params.projectId;
    console.log(req.params)
    const basePath = path.join(__dirname, "projects", projectId);

    const doc = await db.collection("projects").doc(projectId).get();

    if (!doc.exists) {
      return res.send("Project not found");
    }

    const data = doc.data();
    if(data.status !== "uploaded") {
      res.send("Project has not been uploaded yet.");
    }
    // let indexPath = path.join(basePath, "index.html");
    console.log("Checking for the folder");
    if (fs.existsSync("projects") && fs.existsSync(basePath)) {
      console.log(fs.existsSync("projects"), fs.existsSync(basePath));
      console.log("Checking for index.html file in available folder");
      let indexPath = findIndexFile(basePath);
      console.log("found index file: ", indexPath);
      if (indexPath) {
        return res.status(200).sendFile(path.resolve(indexPath));
      }
    }
    console.log("Folder not found");
    const zipUrl = data.zipUrl;    
    const zipPath = `temp/${projectId}.zip`;
    // ✅ Ensure folders exist
    if (!fs.existsSync("projects")) {
      fs.mkdirSync("projects");
    }

    if (!fs.existsSync(extractPath)) {
      fs.mkdirSync(extractPath, { recursive: true });
    }
    await extractZipFile(zipUrl, projectId, extractPath);

    // res.sendFile(path.resolve(`${extractPath}/index.html`));
    indexPath = findIndexFile(extractPath);
    console.log("Index path of the file", indexPath);
    if (!indexPath) {
      return res.status(404).send("index.html not found in project");
    }
    return res.status(200).sendFile(path.resolve(indexPath));

  } catch (err) {
    console.error(err);
    return res.status(500).send("Error loading project");
  }

  // if (!fs.existsSync(indexPath)) {
  //   const folders = fs.readdirSync(basePath);
  //   if (folders.length > 0) {
  //     indexPath = path.join(basePath, folders[0], "index.html");
  //   }
  // }

  // if (fs.existsSync(indexPath)) {
  //   res.sendFile(indexPath);
  // } else {
  //   res.status(404).send("index.html not found");
  // }
});

/*---------------- PUBLISH WEBSITE ------------- */
app.post("/publish/:projectId", async (req, res) => {

  try {

    const projectId = req.params.projectId;

    const publicUrl = `${BASE_URL}/p/${projectId}/`;
    // const publicUrl = `${req.protocol}://${req.get("host")}/p/${projectId}`;

    // Update Firestore
    await db.collection("projects").doc(projectId).set({
      status: "published",
      publicUrl: publicUrl,
      publishedAt: new Date()
    }, { merge: true });

    res.send({
      success: true,
      publicUrl
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Publish error");
  }

});


app.use("/p", express.static(path.join(__dirname, "projects")));

/*---------------- PUBLIC VIEW ----------------------- */
app.get("/p/:projectId/", async (req, res) => {

  try {
    console.log("Entered public view for project ", req.params.projectId);
    const projectId = req.params.projectId;
    const extractPath = `projects/${projectId}`;

    // 🔐 Check if published
    const doc = await db.collection("projects").doc(projectId).get();

    if (!doc.exists) {
      return res.send("Project not found");
    }

    const data = doc.data();

    if (data.status !== "published") {
      return res.send("Project not published yet");
    }
    console.log("Checking if folder exists already");
    if (fs.existsSync("projects") && fs.existsSync(extractPath)) {
      console.log(fs.existsSync("projects"), fs.existsSync(extractPath));
      console.log("Checking if index.html is present");
      // ✅ If already extracted → serve directly
      let indexPath = findIndexFile(extractPath);
      console.log("found index path:", indexPath);
      if (indexPath) {
        return res.status(200).sendFile(path.resolve(indexPath));
      }
    }
    // if (fs.existsSync(`${extractPath}/index.html`)) {
    //   return res.sendFile(path.resolve(`${extractPath}/index.html`));
    // }

    // 🔥 If not extracted → download & extract
    console.log("Folder not found");
    const zipUrl = data.zipUrl;
    const zipPath = `temp/${projectId}.zip`;

    // const response = await axios({
    //   url: zipUrl,
    //   method: "GET",
    //   responseType: "stream"
    // });

    // await new Promise((resolve) => {
    //   const writer = fs.createWriteStream(zipPath);
    //   response.data.pipe(writer);
    //   writer.on("finish", resolve);
    // });

    // ✅ Ensure folders exist
    if (!fs.existsSync("projects")) {
      fs.mkdirSync("projects");
    }

    if (!fs.existsSync(extractPath)) {
      fs.mkdirSync(extractPath, { recursive: true });
    }

    // await fs.ensureDir(extractPath);

    // await fs.createReadStream(zipPath)
    //   .pipe(unzipper.Extract({ path: extractPath }))
    //   .promise();

    await extractZipFile(zipUrl, projectId, extractPath);

    // res.sendFile(path.resolve(`${extractPath}/index.html`));
    indexPath = findIndexFile(extractPath);
    console.log("Index path of the file", indexPath);
    if (!indexPath) {
      return res.status(404).send("index.html not found in project");
    }
    return res.status(200).sendFile(path.resolve(indexPath));

  } catch (err) {
    console.error(err);
    return res.status(500).send("Error loading project");
  }

});

/*----------- Get All Projects------------ */
app.get("/projects", async (req, res) => {
  const snapshot = await db.collection("projects").get();

  const projects = snapshot.docs.map(doc => doc.data());

  res.send(projects);
});

/*--------- Get SPecific Student Projects---------- */
app.get("/projects/:email", async (req, res) => {
  const email = req.params.email;

  const snapshot = await db.collection("projects")
    .where("members", "array-contains", email)
    .get();

  const projects = snapshot.docs.map(doc => doc.data());

  res.send(projects);
});


// ==========================================
// ✅ SERVE PROJECT FILES
// ==========================================
app.use("/projects", express.static(path.join(__dirname, "projects")));


// ==========================================
// ✅ SERVER START
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port ", PORT));