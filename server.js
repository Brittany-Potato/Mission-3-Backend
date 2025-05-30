// ---------------------------- Imports, constants and installs.
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";
const app = express();
const port = 3000;
dotenv.config();

// ---------------------------- Middleware to parse JSON requests.

app.use(express.json());

// ---------------------------- Varables

const key = process.env.API_KEY;
const ai = new GoogleGenAI({ key });

// ---------------------------- Simple GET endpoint.

app.get("./hello", (req, res) => {
  res.json({ message: "Hello from Node.js!" });
});

// ---------------------------- Simple POST end point.

app.post("./echo", (req, res) => {
  res.json({
    message: "You sent this",
    data: req.body,
  });
});

// ---------------------------- Start the server.

app.listen(port, () => {
  console.log(`Server is listening at http://localhost:3000`);
});

async function main() {
  try {
    const model = ai.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(
      "Explain how AI works in a few words"
    );
    const response = await result.response;
    const text = await response.text();

    console.log(response.text);
  } catch (err) {
    console.error("Error generating content:", err);
  }
}

main();
