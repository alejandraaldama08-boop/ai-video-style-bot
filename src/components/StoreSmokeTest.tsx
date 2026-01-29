import React from "react";
import { useEditorStore } from "../store/editorStore";

export default function StoreSmokeTest() {
  const clips = useEditorStore((s) => s.clips);
  const addClips = useEditorStore((s) => s.addClips);
  const clearClips = useEditorStore((s) => s.clearClips);

  return (
    <div style={{ padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
      <div style={{ marginBottom: 8 }}>
        <b>Clips:</b> {clips.length}
      </div>

      <input
        type="file"
        accept="video/*"
        multiple
        onChange={(e) => {
          if (e.target.files) addClips(e.target.files);
          e.currentTarget.value = "";
        }}
      />

      <button style={{ marginLeft: 8 }} onClick={clearClips}>
        Vaciar
      </button>

      <ul style={{ marginTop: 12 }}>
        {clips.map((c) => (
          <li key={c.id}>{c.name}</li>
        ))}
      </ul>
    </div>
  );
}
