// ProcessingHelper.ts
import fs from "node:fs"
import path from "node:path"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import * as axios from "axios"
import { app, BrowserWindow, dialog } from "electron"
import { configHelper } from "./ConfigHelper"

// Interface for Gemini API requests
interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    }
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
}
export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private geminiApiKey: string | null = null

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()
    
    // Initialize AI client based on config
    this.initializeAIClient();
    
    // Listen for config changes to re-initialize the AI client
    configHelper.on('config-updated', () => {
      this.initializeAIClient();
    });
  }
  
  /**
   * Initialize or reinitialize the AI client with current config
   */
  private initializeAIClient(): void {
    try {
      const config = configHelper.loadConfig();
      
      // Hardcode API key for testing
      const hardcodedApiKey = "AIzaSyDQWGG4Q-JvrfB8A0NbhhGa1CdPY5mXoDg";
      if (hardcodedApiKey) {
        this.geminiApiKey = hardcodedApiKey;
        console.log("Using hardcoded Gemini API key for testing");
      } else if (config.apiKey) {
        this.geminiApiKey = config.apiKey;
        console.log("Gemini API key set successfully");
      } else {
        this.geminiApiKey = null;
        console.warn("No API key available, Gemini client not initialized");
      }
    } catch (error) {
      console.error("Failed to initialize AI client:", error);
      this.geminiApiKey = null;
    }
  }

  private async waitForInitialization(
    mainWindow: BrowserWindow
  ): Promise<void> {
    let attempts = 0
    const maxAttempts = 50 // 5 seconds total

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  private async getCredits(): Promise<number> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return 999 // Unlimited credits in this version

    try {
      await this.waitForInitialization(mainWindow)
      return 999 // Always return sufficient credits to work
    } catch (error) {
      console.error("Error getting credits:", error)
      return 999 // Unlimited credits as fallback
    }
  }

  private async getLanguage(): Promise<string> {
    try {
      // Get language from config
      const config = configHelper.loadConfig();
      if (config.language) {
        return config.language;
      }
      
      // Fallback to window variable if config doesn't have language
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        try {
          await this.waitForInitialization(mainWindow)
          const language = await mainWindow.webContents.executeJavaScript(
            "window.__LANGUAGE__"
          )

          if (
            typeof language === "string" &&
            language !== undefined &&
            language !== null
          ) {
            return language;
          }
        } catch (err) {
          console.warn("Could not get language from window", err);
        }
      }
      
      // Default fallback
      return "python";
    } catch (error) {
      console.error("Error getting language:", error)
      return "python"
    }
  }

  public async processScreenshots(explainOnly: boolean = false, generalMode: boolean = false, contextText?: string, selectedPaths?: string[]): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    const config = configHelper.loadConfig();
    
    // Verify we have a valid Gemini API key
    if (!this.geminiApiKey) {
      this.initializeAIClient();
      
      if (!this.geminiApiKey) {
        console.error("Gemini API key not initialized");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.API_KEY_INVALID
        );
        return;
      }
    }

    const view = this.deps.getView()
    console.log("Processing screenshots in view:", view)

    if (view === "queue") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)

      // If context text is provided but no screenshots selected, use text-only processing
      if (contextText && contextText.trim().length > 0 && (!selectedPaths || selectedPaths.length === 0)) {
        console.log("Processing with context text only (no screenshots)");

        try {
          // Initialize AbortController
          this.currentProcessingAbortController = new AbortController()
          const { signal } = this.currentProcessingAbortController

          const result = await this.processContextHelper(contextText, signal, explainOnly, generalMode)

          if (!result.success) {
            console.log("Processing failed:", result.error)
            if (result.error?.includes("API Key") || result.error?.includes("Gemini")) {
              mainWindow.webContents.send(
                this.deps.PROCESSING_EVENTS.API_KEY_INVALID
              )
            } else {
              mainWindow.webContents.send(
                this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
                result.error
              )
            }
            // Reset view back to queue on error
            console.log("Resetting view to queue due to error")
            this.deps.setView("queue")
            return
          }

          // Only set view to solutions if processing succeeded
          console.log("Setting view to solutions after successful processing")
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
            result.data
          )
          this.deps.setView("solutions")
        } catch (error: any) {
          console.error("Processing error:", error)
          const errorMessage = axios.isCancel(error)
            ? "Processing was canceled by the user."
            : error?.message || error?.toString() || "An unexpected error occurred during processing"
          
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            errorMessage
          )
          
          // Reset view back to queue on error
          console.log("Resetting view to queue due to error")
          this.deps.setView("queue")
        } finally {
          this.currentProcessingAbortController = null
        }
        return;
      }

      // Otherwise, process screenshots as normal
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
      console.log("Processing main queue screenshots:", screenshotQueue)

      // Filter screenshots based on selection if provided
      let screenshotsToProcess = screenshotQueue
      if (selectedPaths && selectedPaths.length > 0) {
        screenshotsToProcess = screenshotQueue.filter(path => selectedPaths.includes(path))
        console.log("Filtered screenshots based on selection:", screenshotsToProcess)
      }

      // Check if the queue is empty
      if (!screenshotsToProcess || screenshotsToProcess.length === 0) {
        console.log("No screenshots found in queue or selected");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      // Check that files actually exist
      const existingScreenshots = screenshotsToProcess.filter(path => fs.existsSync(path));
      if (existingScreenshots.length === 0) {
        console.log("Screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      try {
        // Initialize AbortController
        this.currentProcessingAbortController = new AbortController()
        const { signal } = this.currentProcessingAbortController

        const screenshots = await Promise.all(
          existingScreenshots.map(async (path) => {
            try {
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )

        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter(Boolean);

        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data");
        }

        const result = await this.processScreenshotsHelper(validScreenshots, signal, explainOnly, generalMode, contextText)

        if (!result.success) {
          console.log("Processing failed:", result.error)
          if (result.error?.includes("API Key") || result.error?.includes("Gemini")) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.API_KEY_INVALID
            )
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              result.error || "An error occurred during processing"
            )
          }
          // Reset view back to queue on error
          console.log("Resetting view to queue due to error")
          this.deps.setView("queue")
          return
        }

        // Only set view to solutions if processing succeeded
        console.log("Setting view to solutions after successful processing")
        if (result.data) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
            result.data
          )
          this.deps.setView("solutions")
        } else {
          console.error("Processing succeeded but no data returned")
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Processing completed but no data was returned"
          )
          this.deps.setView("queue")
        }
      } catch (error: any) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          error
        )
        console.error("Processing error:", error)
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            error.message || "Server error. Please try again."
          )
        }
        // Reset view back to queue on error
        console.log("Resetting view to queue due to error")
        this.deps.setView("queue")
      } finally {
        this.currentProcessingAbortController = null
      }
    } else {
      // view == 'solutions'
      const extraScreenshotQueue =
        this.screenshotHelper.getExtraScreenshotQueue()
      console.log("Processing extra queue screenshots:", extraScreenshotQueue)
      
      // Check if the extra queue is empty
      if (!extraScreenshotQueue || extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        
        return;
      }

      // Check that files actually exist
      const existingExtraScreenshots = extraScreenshotQueue.filter(path => fs.existsSync(path));
      if (existingExtraScreenshots.length === 0) {
        console.log("Extra screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }
      
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

      // Initialize AbortController
      this.currentExtraProcessingAbortController = new AbortController()
      const { signal } = this.currentExtraProcessingAbortController

      try {
        // Get all screenshots (both main and extra) for processing
        const allPaths = [
          ...this.screenshotHelper.getScreenshotQueue(),
          ...existingExtraScreenshots
        ];
        
        const screenshots = await Promise.all(
          allPaths.map(async (path) => {
            try {
              if (!fs.existsSync(path)) {
                console.warn(`Screenshot file does not exist: ${path}`);
                return null;
              }
              
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )
        
        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter(Boolean);
        
        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data for debugging");
        }
        
        console.log(
          "Combined screenshots for processing:",
          validScreenshots.map((s) => s.path)
        )

        const result = await this.processExtraScreenshotsHelper(
          validScreenshots,
          signal
        )

        if (result.success) {
          this.deps.setHasDebugged(true)
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
            result.data
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            result.error
          )
        }
      } catch (error: any) {
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            "Extra processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            error.message
          )
        }
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal,
    explainOnly: boolean = false,
    generalMode: boolean = false,
    contextText?: string
  ) {
    try {
      const config = configHelper.loadConfig();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();
      
      // Step 1: Extract problem info using Gemini API
      const imageDataList = screenshots.map(screenshot => screenshot.data);
      
      // Update the user on progress
      if (mainWindow) {
        const progressMessage = generalMode 
          ? (contextText ? "Analyzing screenshots with your question..." : "Analyzing content from screenshots...")
          : "Analyzing problem from screenshots...";
        mainWindow.webContents.send("processing-status", {
          message: progressMessage,
          progress: 20
        });
      }

      let problemInfo;
      
      // Use Gemini API
      if (!this.geminiApiKey) {
        return {
          success: false,
          error: "Gemini API key not configured. Please check your settings."
        };
      }

      try {
        // Create Gemini message structure
        let extractionPrompt = generalMode
          ? `Analyze the screenshots carefully. They may contain diagrams, images, text, or visual content. Extract all relevant information including:
- All visible text content
- Description of any diagrams, charts, or visual elements
- Relationships, dependencies, or structures shown in diagrams
- Any questions or concepts being presented`
          : `You are a coding challenge interpreter. Analyze the screenshots of the coding problem and extract all relevant information. Preferred coding language we gonna use for this problem is ${language}.`;

        // Add context text to the prompt if provided
        if (contextText && contextText.trim().length > 0) {
          extractionPrompt += `\n\nADDITIONAL CONTEXT/QUESTION FROM USER:\n${contextText}\n\nPlease analyze the screenshots in the context of this question or request.`;
        }

        extractionPrompt += generalMode
          ? `\n\nReturn the information in JSON format with these fields: 
- problem_statement: A comprehensive description of all content including text, diagrams, and visual elements. Describe what you see in detail, and incorporate the user's question/context.
- constraints: Any constraints, rules, or limitations mentioned (if any)
- example_input: Any example data or input shown (if any)
- example_output: Any example output or result shown (if any)

If a field is not present, use an empty string. Just return the structured JSON without any other text.`
          : `\n\nReturn the information in JSON format with these fields: problem_statement, constraints, example_input, example_output. Just return the structured JSON without any other text.`;

        const geminiMessages: GeminiMessage[] = [
          {
            role: "user",
            parts: [
              {
                text: extractionPrompt
              },
              ...imageDataList.map(data => ({
                inlineData: {
                  mimeType: "image/png",
                  data: data
                }
              }))
            ]
          }
        ];

        // Make API request to Gemini
        const response = await axios.default.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${config.model || "gemini-2.5-flash"}:generateContent?key=${this.geminiApiKey}`,
          {
            contents: geminiMessages,
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 4000
            }
          },
          { signal }
        );

        const responseData = response.data as GeminiResponse;
        
        if (!responseData.candidates || responseData.candidates.length === 0) {
          throw new Error("Empty response from Gemini API");
        }
        
        const responseText = responseData.candidates[0].content.parts[0].text;
        
        // Handle when Gemini might wrap the JSON in markdown code blocks
        const jsonText = responseText.replace(/```json|```/g, '').trim();
        try {
          problemInfo = JSON.parse(jsonText);
          
          // Ensure required fields exist with defaults
          if (!problemInfo || typeof problemInfo !== 'object') {
            throw new Error("Invalid JSON structure");
          }
          
          problemInfo = {
            problem_statement: problemInfo.problem_statement || responseText || "Content from screenshots",
            constraints: problemInfo.constraints || "",
            example_input: problemInfo.example_input || "",
            example_output: problemInfo.example_output || ""
          };
        } catch (parseError) {
          console.error("Error parsing JSON response:", parseError);
          // Fallback: use the raw response text as problem statement
          problemInfo = {
            problem_statement: responseText || "Content from screenshots",
            constraints: "",
            example_input: "",
            example_output: ""
          };
        }
      } catch (error) {
        console.error("Error using Gemini API:", error);
        return {
          success: false,
          error: "Failed to process with Gemini API. Please check your API key or try again later."
        };
      }
      
      // Update the user on progress
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Problem analyzed successfully. Preparing to generate solution...",
          progress: 40
        });
      }

      // Store problem info in AppState
      this.deps.setProblemInfo(problemInfo);

      // Send first success event
      if (mainWindow) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
          problemInfo
        );

        // Generate solutions after successful extraction
        try {
          const solutionsResult = await this.generateSolutionsHelper(signal, explainOnly, generalMode);
          if (solutionsResult.success) {
            // Don't clear extra screenshots - preserve them along with main queue screenshots
            // The main queue screenshots will be preserved and shown in solutions view
            // via the updated get-screenshots handler
            
            // Final progress update
            mainWindow.webContents.send("processing-status", {
              message: "Solution generated successfully",
              progress: 100
            });
            
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
              solutionsResult.data
            );
            return { success: true, data: solutionsResult.data };
          } else {
            throw new Error(
              solutionsResult.error || "Failed to generate solutions"
            );
          }
        } catch (solutionError: any) {
          console.error("Error in generateSolutionsHelper:", solutionError);
          return {
            success: false,
            error: solutionError.message || "Failed to generate solution"
          };
        }
      }

      return { success: false, error: "Failed to process screenshots" };
    } catch (error: any) {
      // If the request was cancelled, don't retry
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }
      
      // Handle Gemini API errors
      if (error?.response?.status === 401) {
        return {
          success: false,
          error: "Invalid Gemini API key. Please check your settings."
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: "Gemini API rate limit exceeded. Please try again later."
        };
      } else if (error?.response?.status === 500) {
        return {
          success: false,
          error: "Gemini server error. Please try again later."
        };
      }

      console.error("API Error Details:", error);
      return { 
        success: false, 
        error: error.message || "Failed to process screenshots. Please try again." 
      };
    }
  }

  private async generateSolutionsHelper(signal: AbortSignal, explainOnly: boolean = false, generalMode: boolean = false) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Ensure problem_statement exists
      const contentToAnalyze = problemInfo.problem_statement || "Content from screenshots";

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: generalMode ? "Explaining general topic..." : explainOnly ? "Generating explanation..." : "Creating optimal solution with detailed explanations...",
          progress: 60
        });
      }

      // Create prompt for solution generation, explanation, or general topic
      const promptText = generalMode ? `
You are an expert educator. Your task is to analyze the provided content (which may include images, diagrams, or text) and provide a clear, comprehensive explanation.

CONTENT TO ANALYZE:
${contentToAnalyze}

INSTRUCTIONS:
1. First, carefully identify if there is a specific question being asked. Look for question marks, phrases like "What is", "How does", "Explain", etc.
2. If a question is found, answer it directly and simply at the start of your response
3. Then provide additional context and explanation
4. If the content involves diagrams, visual concepts, or structured information (like database schemas, flowcharts, dependency diagrams, etc.), provide visual representations in your response

Your response should:
- Use simple, easy-to-understand language
- Break down complex concepts into digestible parts
- Provide concrete examples when helpful
- Avoid unnecessary jargon (or explain it when needed)
- Focus on understanding the core concept, not implementation details
- Include visual/diagram representations when relevant (see format below)

Structure your response as:
1. Direct Answer (if there's a question): Give a clear, concise answer in 1-2 sentences
2. Core Explanation: What is this topic/concept in simple terms?
3. Key Points: Important things to understand (3-5 bullet points)
4. Visual Example/Diagram: When explaining concepts that involve structure, relationships, or visual elements (like database normalization, dependency diagrams, flowcharts, hierarchies, etc.), provide a visual representation using one of these formats:
   - ASCII art diagrams
   - Structured text representations
   - Mermaid diagram syntax (in a code block)
   - PlantUML syntax (in a code block)
   - Simple text-based tables or tree structures
   
   For example, if explaining database normalization, include a visual representation of the table structure. If explaining dependency diagrams, show the relationships visually.
5. Examples/Applications: Real-world examples or use cases
6. Common Confusion: Things people often misunderstand

IMPORTANT: When providing visual examples, use clear formatting and place them in code blocks with appropriate syntax. Make diagrams as detailed and helpful as possible.

Write in a conversational, friendly tone. Imagine you're explaining this to someone who is intelligent but new to the topic.
` : explainOnly ? `
Explain the following coding problem in detail. DO NOT provide any code solution.

PROBLEM STATEMENT:
${problemInfo.problem_statement}

CONSTRAINTS:
${problemInfo.constraints || "No specific constraints provided."}

EXAMPLE INPUT:
${problemInfo.example_input || "No example input provided."}

EXAMPLE OUTPUT:
${problemInfo.example_output || "No example output provided."}

LANGUAGE: ${language}

Please provide a comprehensive explanation that includes:
1. Problem Understanding: What the problem is asking for
2. Approach: How to think about solving this problem (conceptually, without code)
3. Key Insights: Important observations or patterns to recognize
4. Algorithmic Approach: What algorithm or technique would work best
5. Time and Space Complexity: Expected complexities and why

Write your response as a clear, detailed explanation without any code examples.
` : `
Generate a detailed solution for the following coding problem:

PROBLEM STATEMENT:
${problemInfo.problem_statement}

CONSTRAINTS:
${problemInfo.constraints || "No specific constraints provided."}

EXAMPLE INPUT:
${problemInfo.example_input || "No example input provided."}

EXAMPLE OUTPUT:
${problemInfo.example_output || "No example output provided."}

LANGUAGE: ${language}

I need the response in the following format:
1. Code: A clean, optimized implementation in ${language}
2. Your Thoughts: A list of key insights and reasoning behind your approach
3. Time complexity: O(X) with a detailed explanation (at least 2 sentences)
4. Space complexity: O(X) with a detailed explanation (at least 2 sentences)

For complexity explanations, please be thorough. For example: "Time complexity: O(n) because we iterate through the array only once. This is optimal as we need to examine each element at least once to find the solution." or "Space complexity: O(n) because in the worst case, we store all elements in the hashmap. The additional space scales linearly with the input size."

Your solution should be efficient, well-commented, and handle edge cases.
`;

      let responseContent;
      
      // Gemini processing
      if (!this.geminiApiKey) {
        return {
          success: false,
          error: "Gemini API key not configured. Please check your settings."
        };
      }
      
      try {
        // Create Gemini message structure
        const geminiMessages = [
          {
            role: "user",
            parts: [
              {
                text: `You are an expert coding interview assistant. Provide a clear, optimal solution with detailed explanations for this problem:\n\n${promptText}`
              }
            ]
          }
        ];

        // Make API request to Gemini
        const response = await axios.default.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${config.model || "gemini-2.5-flash"}:generateContent?key=${this.geminiApiKey}`,
          {
            contents: geminiMessages,
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 4000
            }
          },
          { signal }
        );

        const responseData = response.data as GeminiResponse;
        
        if (!responseData.candidates || responseData.candidates.length === 0) {
          throw new Error("Empty response from Gemini API");
        }
        
        responseContent = responseData.candidates[0].content.parts[0].text;
      } catch (error) {
        console.error("Error using Gemini API for solution:", error);
        return {
          success: false,
          error: "Failed to generate solution with Gemini API. Please check your API key or try again later."
        };
      }

      // Handle explain-only mode differently
      if (explainOnly) {
        // For explain mode, return the full explanation without extracting code
        const formattedResponse = {
          code: "// No code - explanation only",
          explanation: responseContent,
          thoughts: ["Conceptual explanation provided"],
          time_complexity: "See explanation above",
          space_complexity: "See explanation above"
        };

        return { success: true, data: formattedResponse };
      }

      // Extract parts from the response (code generation mode)
      const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1].trim() : responseContent;

      // Extract thoughts, looking for bullet points or numbered lists
      const thoughtsRegex = /(?:Thoughts:|Key Insights:|Reasoning:|Approach:)([\s\S]*?)(?:Time complexity:|$)/i;
      const thoughtsMatch = responseContent.match(thoughtsRegex);
      let thoughts: string[] = [];
      
      if (thoughtsMatch && thoughtsMatch[1]) {
        // Extract bullet points or numbered items
        const bulletPoints = thoughtsMatch[1].match(/(?:^|\n)\s*(?:[-*•]|\d+\.)\s*(.*)/g);
        if (bulletPoints) {
          thoughts = bulletPoints.map(point => 
            point.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim()
          ).filter(Boolean);
        } else {
          // If no bullet points found, split by newlines and filter empty lines
          thoughts = thoughtsMatch[1].split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        }
      }
      
      // Extract complexity information
      const timeComplexityPattern = /Time complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:Space complexity|$))/i;
      const spaceComplexityPattern = /Space complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:[A-Z]|$))/i;
      
      let timeComplexity = "O(n) - Linear time complexity because we only iterate through the array once. Each element is processed exactly one time, and the hashmap lookups are O(1) operations.";
      let spaceComplexity = "O(n) - Linear space complexity because we store elements in the hashmap. In the worst case, we might need to store all elements before finding the solution pair.";
      
      const timeMatch = responseContent.match(timeComplexityPattern);
      if (timeMatch && timeMatch[1]) {
        timeComplexity = timeMatch[1].trim();
        if (!timeComplexity.match(/O\([^)]+\)/i)) {
          timeComplexity = `O(n) - ${timeComplexity}`;
        } else if (!timeComplexity.includes('-') && !timeComplexity.includes('because')) {
          const notationMatch = timeComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = timeComplexity.replace(notation, '').trim();
            timeComplexity = `${notation} - ${rest}`;
          }
        }
      }
      
      const spaceMatch = responseContent.match(spaceComplexityPattern);
      if (spaceMatch && spaceMatch[1]) {
        spaceComplexity = spaceMatch[1].trim();
        if (!spaceComplexity.match(/O\([^)]+\)/i)) {
          spaceComplexity = `O(n) - ${spaceComplexity}`;
        } else if (!spaceComplexity.includes('-') && !spaceComplexity.includes('because')) {
          const notationMatch = spaceComplexity.match(/O\([^)]+\)/i);
          if (notationMatch) {
            const notation = notationMatch[0];
            const rest = spaceComplexity.replace(notation, '').trim();
            spaceComplexity = `${notation} - ${rest}`;
          }
        }
      }

      const formattedResponse = {
        code: code,
        thoughts: thoughts.length > 0 ? thoughts : ["Solution approach based on efficiency and readability"],
        explanation: "", // No separate explanation in code mode
        time_complexity: timeComplexity,
        space_complexity: spaceComplexity
      };

      return { success: true, data: formattedResponse };
    } catch (error: any) {
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }
      
      if (error?.response?.status === 401) {
        return {
          success: false,
          error: "Invalid Gemini API key. Please check your settings."
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: "Gemini API rate limit exceeded. Please try again later."
        };
      }
      
      console.error("Solution generation error:", error);
      return { success: false, error: error.message || "Failed to generate solution" };
    }
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Update progress status
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Processing debug screenshots...",
          progress: 30
        });
      }

      // Prepare the images for the API call
      const imageDataList = screenshots.map(screenshot => screenshot.data);
      
      let debugContent;
      
      if (!this.geminiApiKey) {
        return {
          success: false,
          error: "Gemini API key not configured. Please check your settings."
        };
      }
      
      try {
        const debugPrompt = `
You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution.

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE WITH THESE SECTION HEADERS:
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`java).
`;

        const geminiMessages = [
          {
            role: "user",
            parts: [
              { text: debugPrompt },
              ...imageDataList.map(data => ({
                inlineData: {
                  mimeType: "image/png",
                  data: data
                }
              }))
            ]
          }
        ];

        if (mainWindow) {
          mainWindow.webContents.send("processing-status", {
            message: "Analyzing code and generating debug feedback with Gemini...",
            progress: 60
          });
        }

        const response = await axios.default.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${config.model || "gemini-2.5-flash"}:generateContent?key=${this.geminiApiKey}`,
          {
            contents: geminiMessages,
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 4000
            }
          },
          { signal }
        );

        const responseData = response.data as GeminiResponse;
        
        if (!responseData.candidates || responseData.candidates.length === 0) {
          throw new Error("Empty response from Gemini API");
        }
        
        debugContent = responseData.candidates[0].content.parts[0].text;
      } catch (error) {
        console.error("Error using Gemini API for debugging:", error);
        return {
          success: false,
          error: "Failed to process debug request with Gemini API. Please check your API key or try again later."
        };
      }
      
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Debug analysis complete",
          progress: 100
        });
      }

      let extractedCode = "// Debug mode - see analysis below";
      const codeMatch = debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        extractedCode = codeMatch[1].trim();
      }

      let formattedDebugContent = debugContent;
      
      if (!debugContent.includes('# ') && !debugContent.includes('## ')) {
        formattedDebugContent = debugContent
          .replace(/issues identified|problems found|bugs found/i, '## Issues Identified')
          .replace(/code improvements|improvements|suggested changes/i, '## Code Improvements')
          .replace(/optimizations|performance improvements/i, '## Optimizations')
          .replace(/explanation|detailed analysis/i, '## Explanation');
      }

      const bulletPoints = formattedDebugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g);
      const thoughts = bulletPoints 
        ? bulletPoints.map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim()).slice(0, 5)
        : ["Debug analysis based on your screenshots"];
      
      const response = {
        code: extractedCode,
        debug_analysis: formattedDebugContent,
        thoughts: thoughts,
        time_complexity: "N/A - Debug mode",
        space_complexity: "N/A - Debug mode"
      };

      return { success: true, data: response };
    } catch (error: any) {
      console.error("Debug processing error:", error);
      return { success: false, error: error.message || "Failed to process debug request" };
    }
  }

  private async processContextHelper(
    contextText: string,
    signal: AbortSignal,
    explainOnly: boolean = false,
    generalMode: boolean = false
  ) {
    try {
      const config = configHelper.loadConfig();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();

      // Store context text as problem info (treating it as a problem statement)
      const problemInfo = {
        problem_statement: contextText,
        constraints: "",
        example_input: "",
        example_output: ""
      };

      this.deps.setProblemInfo(problemInfo);

      // Update the user on progress
      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing your text...",
          progress: 40
        });
      }

      // Generate solutions directly from the text
      const solutionsResult = await this.generateSolutionsHelper(signal, explainOnly, generalMode);
      if (solutionsResult.success) {
        // Don't clear screenshots - they should persist and remain accessible
        // Screenshots will only be deleted when user manually deletes them

        // Final progress update
        if (mainWindow) {
          mainWindow.webContents.send("processing-status", {
            message: "Response generated successfully",
            progress: 100
          });
        }

        return { success: true, data: solutionsResult.data };
      } else {
        throw new Error(
          solutionsResult.error || "Failed to generate response"
        );
      }
    } catch (error: any) {
      // If the request was cancelled, don't retry
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }

      // Handle API errors
      if (error?.response?.status === 401) {
        return {
          success: false,
          error: "Invalid API key. Please check your settings."
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: "API rate limit exceeded. Please try again later."
        };
      }

      console.error("Context processing error:", error);
      return {
        success: false,
        error: error.message || "Failed to process context text. Please try again."
      };
    }
  }

  public async processDirect(contextText: string): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    const config = configHelper.loadConfig();

    // Verify we have a valid Gemini API key
    if (!this.geminiApiKey) {
      this.initializeAIClient();
      if (!this.geminiApiKey) {
        console.error("Gemini API key not initialized");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return;
      }
    }

    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)

    try {
      // Initialize AbortController
      this.currentProcessingAbortController = new AbortController()
      const { signal } = this.currentProcessingAbortController

      // Send directly to AI without any preprocessing
      let responseContent;

      // Only use Gemini
      {
        if (!this.geminiApiKey) {
          throw new Error("Gemini API key not configured");
        }

        const geminiMessages = [
          {
            role: "user",
            parts: [{ text: contextText }]
          }
        ];

        const response = await axios.default.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${config.model || "gemini-2.5-flash"}:generateContent?key=${this.geminiApiKey}`,
          {
            contents: geminiMessages,
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 4000
            }
          },
          { signal }
        );

        const responseData = response.data as GeminiResponse;
        if (!responseData.candidates || responseData.candidates.length === 0) {
          throw new Error("Empty response from Gemini API");
        }

        responseContent = responseData.candidates[0].content.parts[0].text;
      }

      // Format response for display
      const formattedResponse = {
        code: "// Direct answer mode",
        explanation: responseContent,
        thoughts: ["Direct answer provided"],
        time_complexity: "N/A",
        space_complexity: "N/A"
      };

      mainWindow.webContents.send(
        this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
        formattedResponse
      );
      this.deps.setView("solutions");
    } catch (error: any) {
      console.error("Direct processing error:", error);
      mainWindow.webContents.send(
        this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
        error.message || "Failed to get direct answer"
      );
      this.deps.setView("queue");
    } finally {
      this.currentProcessingAbortController = null;
    }
  }

  public cancelOngoingRequests(): void {
    let wasCancelled = false

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    this.deps.setHasDebugged(false)

    this.deps.setProblemInfo(null)

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }
}
