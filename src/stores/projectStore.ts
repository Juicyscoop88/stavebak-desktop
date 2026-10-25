import { create } from 'zustand';

export type DocPhase = 'DSP' | 'DUR' | 'DUSP' | 'DPS';

export interface ProjectState {
  /** Building classification, e.g. "Rodinný dům", "Bytový dům" */
  buildingType: string | null;
  /** Documentation phase */
  phase: DocPhase;
  /** Total DSP sections */
  totalSections: number;
  /** Completed sections */
  completedSections: number;
  /** Current section being worked on */
  currentSection: string | null;
  /** Parcel number */
  parcel: string | null;

  setBuildingType: (type: string | null) => void;
  setPhase: (phase: DocPhase) => void;
  setProgress: (completed: number, total: number) => void;
  setCurrentSection: (section: string | null) => void;
  setParcel: (parcel: string | null) => void;
  reset: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  buildingType: null,
  phase: 'DSP',
  totalSections: 8,
  completedSections: 0,
  currentSection: null,
  parcel: null,

  setBuildingType: (type) => set({ buildingType: type }),
  setPhase: (phase) => set({ phase }),
  setProgress: (completed, total) => set({ completedSections: completed, totalSections: total }),
  setCurrentSection: (section) => set({ currentSection: section }),
  setParcel: (parcel) => set({ parcel }),
  reset: () => set({
    buildingType: null,
    phase: 'DSP',
    totalSections: 8,
    completedSections: 0,
    currentSection: null,
    parcel: null,
  }),
}));
