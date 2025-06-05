// ---------------------------- Imports, constants and installs.
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import path from "path";

const app = express();
const port = process.env.PORT || 3000;
dotenv.config();

// ---------------------------- Middleware to parse JSON requests.

app.use(express.json());

const corsOrigin = process.env.CORS_ORIGIN || '*'; 
app.use(cors({
  origin: corsOrigin,
  methods: ["GET", "POST"]
  })
);

// ---------------------------- Variables

const key = process.env.API_KEY;
const ai = new GoogleGenAI({ apiKey: key });

const SESSIONS_DIR = process.env.SESSIONS_DIR || "./sessions";

//------------------------for the file management 
// make sure sessions directory exists so sessions can be created/stored
async function ensureSessionsDirectory() {
  try {
    await fs.mkdir(SESSIONS_DIR, {recursive: true});
    console.log(`Ensure session directory exists:: ${SESSIONS_DIR}`);
  }
  catch (error) {
    console.error(`Failure to create sessions directory: ${error.message}`);
    process.exit(1);
  }
}

//To get path for session file
function getSessionFilePath(sessionId) {
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

//To load session data from a file
async function loadSession(sessionId) {
  const filePath = getSessionFilePath(sessionId);
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  }
  catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    console.error(`Error loading session ${sessionId}:`, error);
    throw new Error (`Failed to load session ${sessionId}`)
  }
};

// To save session data to a file
async function saveSession(sessionId, sessionData) {
  const filePath = getSessionFilePath(sessionId);
  try{
    await fs.writeFile(filePath, JSON.stringify(sessionData, null, 2), "utf8");
    console.log(`Session ${sessionId} saved.`);
  } 
  catch (error) {
    console.error(`Error saving session ${sessionId}:`, error);
    throw new Error (`Failed to save session ${sessionId}`);
  }
};

//To generate session ID
function generateSessionId(){
  return Math.random().toString(36).substring(2,18);
}

// ---------------------------- Simple GET endpoint.

app.get("/hello", (req, res) => {
  res.json({ message: "Hello from Node.js!" });
});

// ---------------------------- Simple POST end point.

app.post("/echo", (req, res) => {
  res.json({
    message: "You sent this",
    data: req.body,
  });
});

app.post("/ai", async (req, res) => {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: "Tell me a story in only 15 words",
    config: {
        systemInstructions: [
            {
                text: `You are a cat, you can only meow`
            }
        ]
    },
  });
  console.log(response.text);

  res.json({
    message: response.text,
    data: req.body,
  });
});

//Session Management Endpoint ('/session') 
app.get("/session", async (req, res)=> {
  const requestedSessionId = req.query.sessionId;

  try {
    let sessionId;
    let sessionData;

    if (requestedSessionId) {
      // Trying to load existing session
      const loadedSession = await loadSession(requestedSessionId);
      if(loadedSession) {
        sessionId = requestedSessionId;
        sessionData = loadedSession;
        return res.json({
          sessionId, 
          conversationHistory: sessionData.conversationHistory,
          jobTitle: sessionData.jobTitle || ""
        });
      }
      else {
        //session ID not found
        return res.status(404).json({message: "Session ID not found"});
      }
    }
    else {
      //create a new session
      sessionId = generateSessionId();
      sessionData = {
        jobTitle: "",
        conversationHistory: []
      };
      //saves new empty session
      await saveSession(sessionId, sessionData);
      //successful server message for session created
      return res.status(201).json({sessionId, conversationHistory: []})
    }
  }
  catch (error) {
    console.error("Error in /session endpoint", error);
    res.status(500).json({message:"Internal server error in session management, loading or creating new."})
  }

});

// CHAT ENDPOINT FOR LLM AND RESPONSE TO FRONTEND
app.post("/chat", async (req, res) => {
  const {sessionId, contents, jobTitle} = req.body;

  if(!sessionId) {
    return res.status(400).json({message: "Session ID is required"});
  }

  try {
    //load session first
    let session = await loadSession(sessionId);
  
    //session not found error
    if (!session){
      return res.status(404).json({message: "Session not found on server."})
    }

    //front-end should send full conversation
    // The frontend sends the full 'contents' array, but the last item is the new user message.
    // want to add only the new user message to backend loaded history, so backend history from the file is complete and correct.
    const newUserMessageFromFrontend = contents[contents.length - 1];

    // Ensure the new message actually has a role and text
    if (!newUserMessageFromFrontend || !newUserMessageFromFrontend.role || !newUserMessageFromFrontend.parts || !newUserMessageFromFrontend.parts[0]?.text) {
      console.warn("Received malformed user message:", newUserMessageFromFrontend);
      return res.status(400).json({ message: "Invalid user message format." });
        }
        
    // Append the new user message to the server's authoritative conversation history
    session.conversationHistory.push(newUserMessageFromFrontend);    
    
    // If jobTitle is provided and not already set in the session, store it
    if (jobTitle && !session.jobTitle) {
      session.jobTitle = jobTitle;
    }
  
    // Here we can write system instructions so that it's not all in the 'result' code below
    let systemInstructions = [];
    systemInstructions.push({
    text: `You are an experienced professional recruiter specialising in job interviews. You are interviewing the user for ${jobTitle}. You will ask six questions to interview the user and assess their suitability for the position of ${jobTitle} as you see fit, give consideration to their relevant experience if any, their skills, and their personality fit for the job. The six question total can include follow-up questions on the users responses. Your first response must include the question “Tell me about yourself”. After the six questions you will conclude the interview and give feedback on the performance with suggestions for improvement. You can be friendly but must be formal. Your content should be convincingly human-like and engaging. Use a conversational tone, mix professional jargon with casual explanations. Vary sentence length and structure. Include reactions to users responses as appropriate to your role as the interviewer for a job. Use natural language, where appropriate, include casual phrases like "You know what?" or "Honestly". Where appropriate, use transitional phrases like “Let me explain” or “Here’s the thing” to guide the reader smoothly through the content. Where appropriate use analogies that relate to everyday life, mimic human imperfections like slightly informal phrasing or unexpected transitions. Introduce mild repetition of ideas or phrases, as humans naturally do when emphasizing a point or when writing spontaneously. Include subtle, natural digressions or tangents, but ensure they connect back to the main point to maintain focus.`})
      

    //sending full conversation history from server-side to Gemini API.
    //PROBLEM!!!! Gemini not receiving system instructions so changed code to have these instructions at the start of 'content', original code commented out below for reference
    
    //So trying to put system instructions in at the start of content using format required by Gemini API, then spread chat in with it.
    const result = await ai.models.generateContent({
      model: "gemini-2.0-flash", 
      contents: [
        {role:"user", parts: [{text: systemInstructions[0].text}]}, ...session.conversationHistory
      ],
    });
    
    // const result = await ai.models.generateContent({
    //   model: "gemini-2.0-flash", 
    //   contents: session.conversationHistory, 
    //   config: { 
    //     systemInstructions: systemInstructions, 
    //     },
    // });
      
    console.log("Raw result from API:", result); // Added these to try and troubleshoot why Gemini ignoring system Instructions 
    console.log(result.text);
    // Extract the text from the response 
    const aiResponse = result.text;
    

    // Add AI response to the session's conversation history
    session.conversationHistory.push({
       role: 'model',
       parts: [{ text: aiResponse }]
    });

    await saveSession(sessionId, session); // Save the updated session data to file

    res.json({ aiResponse });

    } catch (error) {
      console.error(`Error in /chat endpoint for session ${sessionId}:`, error.response ? error.response.data : error.message);
      res.status(500).json({ message: "Error processing chat or communicating with AI model", error: error.message });
    }
})


// ---------------------------- Start the server.

// Ensure sessions directory exists before starting the server
ensureSessionsDirectory().then(() => {
    app.listen(port, () => {
        console.log(`Server is listening at http://localhost:${port}`);
    });
}).catch(error => {
    console.error("Failed to start server due to directory creation error:", error);
    process.exit(1); // Exit if directory cannot be ensured
});



