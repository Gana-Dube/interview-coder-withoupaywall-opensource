import React from "react"
import ScreenshotItem from "./ScreenshotItem"

interface Screenshot {
  path: string
  preview: string
}

interface ScreenshotQueueProps {
  isLoading: boolean
  screenshots: Screenshot[]
  onDeleteScreenshot: (index: number) => void
  selectedScreenshots: Set<string>
  onToggleSelection: (path: string) => void
}
const ScreenshotQueue: React.FC<ScreenshotQueueProps> = ({
  isLoading,
  screenshots,
  onDeleteScreenshot,
  selectedScreenshots,
  onToggleSelection
}) => {
  if (screenshots.length === 0) {
    return <></>
  }

  const displayScreenshots = screenshots.slice(0, 5)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-4">
        {displayScreenshots.map((screenshot, index) => (
          <ScreenshotItem
            key={screenshot.path}
            isLoading={isLoading}
            screenshot={screenshot}
            index={index}
            onDelete={onDeleteScreenshot}
            isSelected={selectedScreenshots.has(screenshot.path)}
            onToggleSelection={() => onToggleSelection(screenshot.path)}
          />
        ))}
      </div>
      {/* Selection buttons row */}
      <div className="flex gap-4 justify-center">
        {displayScreenshots.map((screenshot, index) => (
          <button
            key={screenshot.path}
            onClick={() => onToggleSelection(screenshot.path)}
            className={`w-[200px] h-8 rounded text-xs font-medium transition-colors ${
              selectedScreenshots.has(screenshot.path)
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            {index + 1}
          </button>
        ))}
      </div>
    </div>
  )
}

export default ScreenshotQueue
