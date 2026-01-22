// src/components/ScreenshotItem.tsx
import React, { useState, useEffect, useRef } from "react"
import { X, Plus, Minus } from "lucide-react"

interface Screenshot {
  path: string
  preview: string
}

interface ScreenshotItemProps {
  screenshot: Screenshot
  onDelete: (index: number) => void
  index: number
  isLoading: boolean
  isSelected?: boolean
  onToggleSelection?: () => void
}

const ScreenshotItem: React.FC<ScreenshotItemProps> = ({
  screenshot,
  onDelete,
  index,
  isLoading,
  isSelected = false,
  onToggleSelection
}) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const imageContainerRef = useRef<HTMLDivElement>(null)

  // Prevent body scroll when expanded
  useEffect(() => {
    if (isExpanded) {
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = ""
      }
    }
  }, [isExpanded])

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await onDelete(index)
  }

  const handleClose = () => {
    setIsExpanded(false)
    setZoomLevel(1) // Reset zoom when closing
    setPanPosition({ x: 0, y: 0 }) // Reset pan position
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close if clicking directly on the backdrop, not on child elements
    if (e.target === e.currentTarget) {
      handleClose()
    }
  }

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation()
    setZoomLevel((prev) => {
      const newZoom = Math.min(prev + 0.25, 3) // Max 3x zoom
      // Reset pan when zooming in from 1x
      if (prev <= 1 && newZoom > 1) {
        setPanPosition({ x: 0, y: 0 })
      }
      return newZoom
    })
  }

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation()
    setZoomLevel((prev) => {
      const newZoom = Math.max(prev - 0.25, 0.5) // Min 0.5x zoom
      // Reset pan position when zooming out to 1x or below
      if (newZoom <= 1) {
        setPanPosition({ x: 0, y: 0 })
      }
      return newZoom
    })
  }

  // Handle mouse down for dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel > 1) {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(true)
      setDragStart({
        x: e.clientX - panPosition.x,
        y: e.clientY - panPosition.y
      })
    }
  }

  // Handle mouse move for dragging
  useEffect(() => {
    if (!isDragging || zoomLevel <= 1) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!imageRef.current || !containerRef.current) return

      const newX = e.clientX - dragStart.x
      const newY = e.clientY - dragStart.y

      // Get image dimensions (already scaled by zoom level via width/height)
      const img = imageRef.current
      const imgRect = img.getBoundingClientRect()
      const containerRect = containerRef.current.getBoundingClientRect()

      // Calculate bounds based on actual rendered size
      const maxX = Math.max(0, (imgRect.width - containerRect.width) / 2)
      const maxY = Math.max(0, (imgRect.height - containerRect.height) / 2)

      // Constrain pan position
      const constrainedX = Math.max(-maxX, Math.min(maxX, newX))
      const constrainedY = Math.max(-maxY, Math.min(maxY, newY))

      setPanPosition({ x: constrainedX, y: constrainedY })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isDragging, dragStart, zoomLevel])

  const handleToggleExpand = () => {
    if (!isLoading) {
      setIsExpanded(true)
      setZoomLevel(1) // Reset zoom when opening
      setPanPosition({ x: 0, y: 0 }) // Reset pan position
    }
  }

  // Handle image load to get natural dimensions and calculate base display size
  const handleImageLoad = () => {
    if (imageRef.current && containerRef.current) {
      const img = imageRef.current
      const naturalWidth = img.naturalWidth
      const naturalHeight = img.naturalHeight
      
      // Calculate base display size to fit in 90vw/90vh while maintaining aspect ratio
      const maxDisplayWidth = window.innerWidth * 0.9
      const maxDisplayHeight = window.innerHeight * 0.9
      
      const aspectRatio = naturalWidth / naturalHeight
      let baseWidth = maxDisplayWidth
      let baseHeight = maxDisplayWidth / aspectRatio
      
      if (baseHeight > maxDisplayHeight) {
        baseHeight = maxDisplayHeight
        baseWidth = maxDisplayHeight * aspectRatio
      }
      
      setImageSize({
        width: baseWidth,
        height: baseHeight
      })
    }
  }

  // Handle escape key to close
  useEffect(() => {
    if (!isExpanded) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsExpanded(false)
        setZoomLevel(1)
      }
    }

    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [isExpanded])

  if (isExpanded) {
    return (
      <div 
        ref={containerRef}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
        onClick={handleBackdropClick}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div 
          className="relative w-full h-full flex items-center justify-center p-4 overflow-hidden"
        >
          <div
            ref={imageContainerRef}
            className="flex items-center justify-center will-change-transform"
            style={{
              transform: `translate(${panPosition.x}px, ${panPosition.y}px)`,
              transition: isDragging ? "none" : "transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
              cursor: zoomLevel > 1 ? (isDragging ? "grabbing" : "grab") : "default"
            }}
            onMouseDown={handleMouseDown}
            onClick={(e) => {
              // Only stop propagation if not dragging (to allow backdrop click)
              if (!isDragging) {
                e.stopPropagation()
              }
            }}
          >
            <img
              ref={imageRef}
              src={screenshot.preview}
              alt="Screenshot"
              onLoad={handleImageLoad}
              style={{
                width: imageSize.width > 0 
                  ? `${imageSize.width * zoomLevel}px`
                  : 'auto',
                height: imageSize.height > 0
                  ? `${imageSize.height * zoomLevel}px`
                  : 'auto',
                maxWidth: 'none',
                maxHeight: 'none',
                objectFit: 'contain',
                imageRendering: 'auto',
                transition: isDragging ? 'none' : 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1), height 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
              className="rounded-lg shadow-2xl select-none pointer-events-none"
              draggable={false}
            />
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleClose()
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute top-4 right-4 p-2 rounded-full bg-black/70 text-white hover:bg-black/90 transition-colors z-10"
            aria-label="Close expanded view"
          >
            <X size={24} />
          </button>
          <div 
            className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2 z-10"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleZoomOut}
              disabled={zoomLevel <= 0.5}
              className="p-2 rounded-full bg-black/70 text-white hover:bg-black/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Zoom out"
            >
              <Minus size={20} />
            </button>
            <button
              onClick={handleZoomIn}
              disabled={zoomLevel >= 3}
              className="p-2 rounded-full bg-black/70 text-white hover:bg-black/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Zoom in"
            >
              <Plus size={20} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        className={`border relative w-[200px] h-[112px] ${
          isLoading ? "border-white" : isSelected ? "border-blue-500 border-2" : "border-white group cursor-pointer"
        }`}
        onClick={handleToggleExpand}
      >
        <div className="w-full h-full relative">
          {isLoading && (
            <div className="absolute inset-0 bg-black bg-opacity-50 z-10 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          <img
            src={screenshot.preview}
            alt="Screenshot"
            className={`w-full h-full object-cover transition-transform duration-300 ${
              isLoading
                ? "opacity-50"
                : "group-hover:scale-105 group-hover:brightness-75"
            }`}
          />
        </div>
        {!isLoading && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleDelete(e)
            }}
            className="absolute top-2 left-2 p-1 rounded-full bg-black bg-opacity-50 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            aria-label="Delete screenshot"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </>
  )
}

export default ScreenshotItem
