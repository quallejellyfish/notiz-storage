require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const { buffer } = require("stream/consumers");
const { prototype } = require("events");

const app = express();
app.use(cors());
app.use(express.json());

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
    console.error("nap", err.message);
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

app.post("/api/add", async (req, res) => {
  const { parentId, newData } = req.body;

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
