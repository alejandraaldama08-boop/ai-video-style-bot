import { create } from "zustand";
import { nanoid } from "nanoid";

export type ClipItem = {
  id: string;
  file: File;
  name: string;
};

type EditorState = {
  clips: ClipItem[];
  addClips: (files: FileList | File[]) => void;
  clearClips: () => void;
};

export const useEditorStore = create<EditorState>((set) => ({
  clips: [],

  addClips: (files) => {
    const list = Array.isArray(files) ? files : Array.from(files);
    set((state) => ({
      clips: [
        ...state.clips,
        ...list.map((f) => ({
          id: nanoid(),
          file: f,
          name: f.name,
        })),
      ],
    }));
  },

  clearClips: () => set({ clips: [] }),
}));
