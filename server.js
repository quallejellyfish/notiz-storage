require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use(express.static(__dirname));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_FILE_PATH = "data.json";

let currentData = {};

async function fetchDataFromGithub() {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}?ref=${GITHUB_BRANCH}`;
    const response = await axios.get(url, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` },
    });
    const content = Buffer.from(response.data.content, "base64").toString(
      "utf8",
    );
    currentData = JSON.parse(content);
    console.log("Github Daten geladen");
  } catch (err) {
    console.error("Fehler beim Laden von Github:", err.message);
    currentData = { id: "root", title: "Notiz Storage", children: [] };
  }
}

async function saveDataToGithub(newData) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
  const getResponse = await axios.get(`${url}?ref=${GITHUB_BRANCH}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` },
  });
  const sha = getResponse.data.sha;
  const contentBase64 = Buffer.from(JSON.stringify(newData, null, 2)).toString(
    "base64",
  );
  await axios.put(
    url,
    {
      message: "Neuer Content!",
      content: contentBase64,
      sha: sha,
      branch: GITHUB_BRANCH,
    },
    {
      headers: { Authorization: `token ${GITHUB_TOKEN}` },
    },
  );

  currentData = newData;
  console.log("Zu Github gespeichert");
}

app.get("/api/data", (req, res) => {
  res.json(currentData);
});

app.get("/api/image/:filename", async (req, res) => {
  const { filename } = req.params;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/images/${filename}?ref=${GITHUB_BRANCH}`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3.raw",
      },
      responseType: "arraybuffer", // Important: Get raw binary data
    });

    // Determine the correct content type
    const ext = filename.split(".").pop().toLowerCase();
    let contentType = "image/png";
    if (ext === "jpg" || ext === "jpeg") contentType = "image/jpeg";
    else if (ext === "gif") contentType = "image/gif";
    else if (ext === "webp") contentType = "image/webp";
    else if (ext === "svg") contentType = "image/svg+xml";

    res.setHeader("Content-Type", contentType);
    res.send(response.data);
  } catch (error) {
    console.error("Bild Proxy Fehler:", error.message);
    res.status(404).send("Bild nicht gefunden");
  }
});

app.post("/api/upload", async (req, res) => {
  const { imageData, filename } = req.body;
  if (!imageData)
    return res.status(400).json({ error: "Keine Bilddaten übermittelt." });

  const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
  const uniqueFilename = `${Date.now()}-${filename.replace(/[^a-z0-9.]/gi, "_")}`;
  const imagePath = `images/${uniqueFilename}`;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${imagePath}`;

  try {
    try {
      await axios.get(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/images?ref=${GITHUB_BRANCH}`,
        { headers: { Authorization: `token ${GITHUB_TOKEN}` } },
      );
    } catch (e) {
      if (e.response && e.response.status === 404) {
        console.log("'images' Ordner nicht gefunden. Erstelle Ordner...");
        await axios.put(
          `https://api.github.com/repos/${GITHUB_REPO}/contents/images/.gitkeep`,
          {
            message: "Create images folder",
            content: Buffer.from("").toString("base64"),
            branch: GITHUB_BRANCH,
          },
          { headers: { Authorization: `token ${GITHUB_TOKEN}` } },
        );
      }
    }

    await axios.put(
      url,
      {
        message: `Upload image: ${uniqueFilename}`,
        content: base64Data,
        branch: GITHUB_BRANCH,
      },
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } },
    );

    const proxyUrl = `/api/image/${uniqueFilename}`;
    console.log("Bild hochgeladen:", proxyUrl);
    res.json({ success: true, url: proxyUrl });
  } catch (error) {
    console.error(
      "Bild Upload Fehler:",
      error.response ? error.response.data : error.message,
    );
    res
      .status(500)
      .json({ error: "Fehler beim Hochladen des Bildes zu GitHub." });
  }
});

function idExists(node, targetId) {
  if (node.id === targetId) return true;
  if (node.children) {
    for (let child of node.children) {
      if (idExists(child, targetId)) return true;
    }
  }
  return false;
}

app.post("/api/add", async (req, res) => {
  const { parentId, newData } = req.body;

  if (!parentId || typeof parentId !== "string") {
    return res.status(400).json({ error: "Ungültige Parent ID." });
  }
  if (
    !newData ||
    typeof newData !== "object" ||
    !newData.title ||
    !newData.id
  ) {
    return res
      .status(400)
      .json({ error: "Ungültige Datenstruktur übermittelt." });
  }

  newData.title = newData.title.trim().substring(0, 100);
  if (newData.date) newData.date = newData.date.trim().substring(0, 50);
  if (newData.content) newData.content = newData.content.substring(0, 8000000);

  if (idExists(currentData, newData.id)) {
    return res.status(400).json({ error: "Diese ID existiert bereits." });
  }
  function addChildToTree(node, targetId, dataToAdd) {
    if (node.id === targetId) {
      if (!node.children) node.children = [];
      node.children.push(newData);
      return true;
    }
    if (node.children) {
      for (let child of node.children) {
        if (addChildToTree(child, targetId, dataToAdd)) return true;
      }
    }
    return false;
  }
  try {
    const success = addChildToTree(currentData, parentId, newData);
    if (!success) return res.status(404).json({ error: "Parent ID not found" });
    await saveDataToGithub(currentData);
    res.json({
      success: true,
      message: "Daten wurden hinzugefügt und gespeichert",
    });
  } catch (err) {
    console.error(
      "Speicherungsfehler:",
      err.response ? err.response.data : err.message,
    );
    res.status(500).json({ error: "Fehler bei der Speicherung nach GitHub" });
  }
});

fetchDataFromGithub().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server läuft: ${PORT}`));
});
