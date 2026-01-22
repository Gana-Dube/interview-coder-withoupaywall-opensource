import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Settings } from "lucide-react";
import { useToast } from "../../contexts/toast";

type GeminiModel = {
  id: string;
  name: string;
  description: string;
};

// Latest Gemini models (as of 2025)
const geminiModels: GeminiModel[] = [
  {
    id: "gemini-3-pro-preview",
    name: "Gemini 3 Pro",
    description: "Most intelligent model for multimodal understanding with advanced agentic and coding capabilities"
  },
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash",
    description: "Most balanced model built for speed and scale with upgraded visual and spatial reasoning"
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    description: "Advanced model for complex tasks with agentic capabilities"
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "Best price and performance with thinking capabilities"
  }
];

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SettingsDialog({ open: externalOpen, onOpenChange }: SettingsDialogProps) {
  const [open, setOpen] = useState(externalOpen || false);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  // Sync with external open state
  useEffect(() => {
    if (externalOpen !== undefined) {
      setOpen(externalOpen);
    }
  }, [externalOpen]);

  // Handle open state changes
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    // Only call onOpenChange when there's actually a change
    if (onOpenChange && newOpen !== externalOpen) {
      onOpenChange(newOpen);
    }
  };
  
  // Load current config on dialog open
  useEffect(() => {
    if (open) {
      setIsLoading(true);
      interface Config {
        apiKey?: string;
        model?: string;
      }

      window.electronAPI
        .getConfig()
        .then((config: Config) => {
          setApiKey(config.apiKey || "");
          setModel(config.model || "gemini-2.5-flash");
        })
        .catch((error: unknown) => {
          console.error("Failed to load config:", error);
          showToast("Error", "Failed to load settings", "error");
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open, showToast]);


  const handleSave = async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.updateConfig({
        apiKey,
        model,
      });
      
      if (result) {
        showToast("Success", "Settings saved successfully", "success");
        handleOpenChange(false);
        
        // Force reload the app to apply the API key
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      showToast("Error", "Failed to save settings", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Mask API key for display
  const maskApiKey = (key: string) => {
    if (!key || key.length < 10) return "";
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  };

  // Open external link handler
  const openExternalLink = (url: string) => {
    window.electronAPI.openLink(url);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className="sm:max-w-md bg-black border border-white/10 text-white settings-dialog"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(450px, 90vw)',
          height: 'auto',
          minHeight: '400px',
          maxHeight: '90vh',
          overflowY: 'auto',
          zIndex: 9999,
          margin: 0,
          padding: '20px',
          transition: 'opacity 0.25s ease, transform 0.25s ease',
          animation: 'fadeIn 0.25s ease forwards',
          opacity: 0.98
        }}
      >        
        <DialogHeader>
          <DialogTitle>API Settings</DialogTitle>
          <DialogDescription className="text-white/70">
            Configure your API key and model preferences. You'll need your own API key to use this application.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Gemini Model Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white">Gemini Model</label>
            <p className="text-xs text-white/60 -mt-1 mb-2">
              Select which Gemini model to use for all operations (problem extraction, solution generation, and debugging)
            </p>
            <div className="space-y-2">
              {geminiModels.map((m) => (
                <div
                  key={m.id}
                  className={`p-2 rounded-lg cursor-pointer transition-colors ${
                    model === m.id
                      ? "bg-white/10 border border-white/20"
                      : "bg-black/30 border border-white/5 hover:bg-white/5"
                  }`}
                  onClick={() => setModel(m.id)}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        model === m.id ? "bg-white" : "bg-white/20"
                      }`}
                    />
                    <div>
                      <p className="font-medium text-white text-sm">{m.name}</p>
                      <p className="text-xs text-white/60">{m.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-white" htmlFor="apiKey">
              Gemini API Key
            </label>
            <Input
              id="apiKey"
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your Gemini API key"
              className="bg-black/50 border-white/10 text-white font-mono text-sm"
            />
            <p className="text-xs text-white/50">
              Your API key is stored locally and never sent to any server except Google
            </p>
            <div className="mt-2 p-2 rounded-md bg-white/5 border border-white/10">
              <p className="text-xs text-white/80 mb-1">Don't have an API key?</p>
              <p className="text-xs text-white/60 mb-1">1. Create an account at <button 
                onClick={() => openExternalLink('https://aistudio.google.com/')} 
                className="text-blue-400 hover:underline cursor-pointer">Google AI Studio</button>
              </p>
              <p className="text-xs text-white/60 mb-1">2. Go to the <button 
                onClick={() => openExternalLink('https://aistudio.google.com/app/apikey')} 
                className="text-blue-400 hover:underline cursor-pointer">API Keys</button> section
              </p>
              <p className="text-xs text-white/60">3. Create a new API key and paste it here</p>
            </div>
          </div>
          
          <div className="space-y-2 mt-4">
            <label className="text-sm font-medium text-white mb-2 block">Commands</label>
            <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-3">
              <div>
                <div className="text-xs font-medium text-white/90 mb-1">Solve (Ctrl+Enter / Cmd+Enter)</div>
                <div className="text-xs text-white/60">Analyzes screenshots and generates a complete solution with code, explanation, and complexity analysis.</div>
              </div>
              <div>
                <div className="text-xs font-medium text-white/90 mb-1">Explain (Ctrl+E / Cmd+E)</div>
                <div className="text-xs text-white/60">Provides a detailed algorithm explanation without generating code. Focuses on the approach and reasoning.</div>
              </div>
              <div>
                <div className="text-xs font-medium text-white/90 mb-1">General (Ctrl+G / Cmd+G)</div>
                <div className="text-xs text-white/60">Explains general concepts, data structures, or algorithms related to the problem. Educational focus without specific code.</div>
              </div>
            </div>
          </div>
          
          <div className="space-y-2 mt-4">
            <label className="text-sm font-medium text-white mb-2 block">Keyboard Shortcuts</label>
            <div className="bg-black/30 border border-white/10 rounded-lg p-3">
              <div className="grid grid-cols-2 gap-y-2 text-xs">
                <div className="text-white/70">Toggle Visibility</div>
                <div className="text-white/90 font-mono">Ctrl+B / Cmd+B</div>
                
                <div className="text-white/70">Take Screenshot</div>
                <div className="text-white/90 font-mono">Ctrl+H / Cmd+H</div>
                
                <div className="text-white/70">Solve</div>
                <div className="text-white/90 font-mono">Ctrl+Enter / Cmd+Enter</div>
                
                <div className="text-white/70">Explain</div>
                <div className="text-white/90 font-mono">Ctrl+E / Cmd+E</div>
                
                <div className="text-white/70">General</div>
                <div className="text-white/90 font-mono">Ctrl+G / Cmd+G</div>
                
                <div className="text-white/70">Delete Last Screenshot</div>
                <div className="text-white/90 font-mono">Ctrl+L / Cmd+L</div>
                
                <div className="text-white/70">Reset View</div>
                <div className="text-white/90 font-mono">Ctrl+R / Cmd+R</div>
                
                <div className="text-white/70">Quit Application</div>
                <div className="text-white/90 font-mono">Ctrl+Q / Cmd+Q</div>
                
                <div className="text-white/70">Move Window</div>
                <div className="text-white/90 font-mono">Ctrl+Arrow Keys</div>
                
                <div className="text-white/70">Decrease Opacity</div>
                <div className="text-white/90 font-mono">Ctrl+[ / Cmd+[</div>
                
                <div className="text-white/70">Increase Opacity</div>
                <div className="text-white/90 font-mono">Ctrl+] / Cmd+]</div>
                
                <div className="text-white/70">Zoom Out</div>
                <div className="text-white/90 font-mono">Ctrl+- / Cmd+-</div>
                
                <div className="text-white/70">Reset Zoom</div>
                <div className="text-white/90 font-mono">Ctrl+0 / Cmd+0</div>
                
                <div className="text-white/70">Zoom In</div>
                <div className="text-white/90 font-mono">Ctrl+= / Cmd+=</div>
              </div>
            </div>
          </div>
          
        </div>
        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-white/10 hover:bg-white/5 text-white"
          >
            Cancel
          </Button>
          <Button
            className="px-4 py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-colors"
            onClick={handleSave}
            disabled={isLoading || !apiKey}
          >
            {isLoading ? "Saving..." : "Save Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
