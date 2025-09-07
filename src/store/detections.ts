import { create } from "zustand";
import type { Detection } from "@/lib/overlay";

export type DetectionsState = {
  detections: Detection[];
  grouped: Record<string, Detection[]>;
  acceptedById: Record<string, boolean>;
  setDetections: (items: Detection[]) => void;
  setAccepted: (id: string, accepted: boolean) => void;
  acceptAllOfType: (type: string) => void;
  rejectAllOfType: (type: string) => void;
  clear: () => void;
};

export const useDetections = create<DetectionsState>((set) => ({
  detections: [],
  grouped: {},
  acceptedById: {},
  setDetections: (items) =>
    set(() => ({
      detections: items,
      grouped: items.reduce((acc, d) => {
        acc[d.type] ||= [];
        acc[d.type].push(d);
        return acc;
      }, {} as Record<string, Detection[]>),
    })),
  setAccepted: (id, accepted) =>
    set((state) => ({ acceptedById: { ...state.acceptedById, [id]: accepted } })),
  acceptAllOfType: (type) =>
    set((state) => {
      const updates: Record<string, boolean> = {};
      state.detections.forEach((d) => {
        if (d.type === type) updates[d.id] = true;
      });
      return { acceptedById: { ...state.acceptedById, ...updates } };
    }),
  rejectAllOfType: (type) =>
    set((state) => {
      const updates: Record<string, boolean> = {};
      state.detections.forEach((d) => {
        if (d.type === type) updates[d.id] = false;
      });
      return { acceptedById: { ...state.acceptedById, ...updates } };
    }),
  clear: () => set({ detections: [], grouped: {}, acceptedById: {} }),
}));


