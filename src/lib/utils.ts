import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Utility function for combining multiple bounding boxes into a single union box
export function unionBBoxes(bboxes: Array<{ x0: number; y0: number; x1: number; y1: number }>) {
  if (bboxes.length === 0) {
    return { x0: 0, y0: 0, x1: 0, y1: 0 };
  }
  
  return {
    x0: Math.min(...bboxes.map((b) => b.x0)),
    y0: Math.min(...bboxes.map((b) => b.y0)),
    x1: Math.max(...bboxes.map((b) => b.x1)),
    y1: Math.max(...bboxes.map((b) => b.y1)),
  };
}
