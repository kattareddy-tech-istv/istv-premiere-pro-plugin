/**
 * host.jsx — ExtendScript bridge for Adobe Premiere Pro
 * Runs inside the Premiere Pro scripting engine (not the browser).
 * Called from the panel via CSInterface.evalScript().
 */

/**
 * Return the absolute path to the plugin's root directory.
 * Used by the auto-updater to know where to write updated files.
 * Works by inspecting the path of this very script (host.jsx lives at
 * {plugin_root}/jsx/host.jsx, so parent.parent = plugin root).
 *
 * @returns {string} JSON: { success: true, path: "C:\\...\\com.insidesuccesstv.cutsheet" }
 */
function getPluginPath() {
  try {
    var scriptFile = new File($.fileName);
    var pluginDir = scriptFile.parent.parent.fsName;
    return JSON.stringify({ success: true, path: pluginDir });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Import an XML file into the active Premiere Pro project.
 * @param {string} xmlPath - Absolute path to the FCP XML file
 * @returns {string} JSON: { success: true } | { success: false, error: "..." }
 */
function importXMLToProject(xmlPath) {
  try {
    if (!app.project) {
      return JSON.stringify({ success: false, error: "No project is currently open." });
    }

    // Import the file into the project root bin
    var importResult = app.project.importFiles(
      [xmlPath],
      true,  // suppressUI
      app.project.rootItem,
      false  // importAsNumberedStills
    );

    if (!importResult) {
      return JSON.stringify({ success: false, error: "Import returned false. Check that the XML is a valid FCP 7 XML file." });
    }

    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Get information about the active sequence.
 * @returns {string} JSON with sequence name, frame rate, duration, etc.
 */
function getActiveSequenceInfo() {
  try {
    if (!app.project) {
      return JSON.stringify({ success: false, error: "No project open." });
    }
    var seq = app.project.activeSequence;
    if (!seq) {
      return JSON.stringify({ success: false, error: "No active sequence." });
    }
    return JSON.stringify({
      success: true,
      name: seq.name,
      id: seq.sequenceID,
      frameRate: seq.timebase,
      duration: seq.end,
      projectPath: app.project.path,
      projectName: app.project.name
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Get the filesystem path to the current project's directory.
 * @returns {string} JSON with the project folder path.
 */
function getProjectPath() {
  try {
    if (!app.project || !app.project.path) {
      return JSON.stringify({ success: false, error: "No project open." });
    }
    var fullPath = app.project.path;
    // Strip the project filename to get the folder
    var folder = fullPath.replace(/[^\/\\]+$/, "");
    return JSON.stringify({ success: true, path: folder, fullPath: fullPath });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Open a file chooser dialog and return the selected path.
 * @returns {string} JSON with the selected file path.
 */
function browseForAudioFile() {
  try {
    var f = File.openDialog("Select audio file", "Audio Files:*.mp3,*.wav,*.m4a,*.aac,*.mp4,*.mov,*.mxf,*.aif,*.aiff");
    if (f) {
      return JSON.stringify({ success: true, path: f.fsName });
    }
    return JSON.stringify({ success: false, error: "No file selected." });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Write text content to a file on disk.
 * Used to save the cut sheet as a .txt file next to the project.
 * @param {string} filePath - Absolute path to write to
 * @param {string} content  - Text content
 * @returns {string} JSON result
 */
function writeTextFile(filePath, content) {
  try {
    var f = new File(filePath);
    f.encoding = "UTF-8";
    f.open("w");
    f.write(content);
    f.close();
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Scan the active Premiere Pro sequence and return full track/clip info.
 * This is the data sent to Claude for multicam analysis.
 * @returns {string} JSON with sequence name, tracks, clips, timecodes
 */
function getMulticamSequenceInfo() {
  try {
    if (!app.project) {
      return JSON.stringify({ success: false, error: "No project is open." });
    }
    var seq = app.project.activeSequence;
    if (!seq) {
      return JSON.stringify({ success: false, error: "No active sequence. Open or click on a sequence in Premiere Pro first." });
    }

    var fps = parseFloat(seq.timebase) || 25;
    var durSeconds = seq.end ? (parseFloat(seq.end.seconds) || 0) : 0;

    var info = {
      success: true,
      sequence_name: seq.name || "Untitled Sequence",
      sequence_id: seq.sequenceID || "",
      frame_rate: fps,
      duration_seconds: durSeconds,
      video_tracks: [],
      audio_tracks: []
    };

    // ── Video tracks ──────────────────────────────────────────────────
    var numVTracks = seq.videoTracks ? seq.videoTracks.numTracks : 0;
    for (var v = 0; v < numVTracks; v++) {
      var vt = seq.videoTracks[v];
      if (!vt) continue;
      var trackClips = [];
      var numClips = vt.clips ? vt.clips.numItems : 0;
      for (var c = 0; c < numClips; c++) {
        var clip = vt.clips[c];
        if (!clip) continue;
        try {
          var startSec = clip.start ? parseFloat(clip.start.seconds) : 0;
          var endSec = clip.end ? parseFloat(clip.end.seconds) : 0;
          var inSec = clip.inPoint ? parseFloat(clip.inPoint.seconds) : 0;
          var outSec = clip.outPoint ? parseFloat(clip.outPoint.seconds) : 0;
          trackClips.push({
            name: clip.name || ("clip_" + c),
            start_seconds: startSec,
            end_seconds: endSec,
            in_seconds: inSec,
            out_seconds: outSec,
            duration_seconds: endSec - startSec,
            type: clip.mediaType || "video"
          });
        } catch (clipErr) {
          // Skip clips that throw errors
        }
      }
      info.video_tracks.push({
        index: v,
        name: vt.name || ("Video " + (v + 1)),
        clip_count: trackClips.length,
        clips: trackClips
      });
    }

    // ── Audio tracks ──────────────────────────────────────────────────
    var numATracks = seq.audioTracks ? seq.audioTracks.numTracks : 0;
    for (var a = 0; a < numATracks; a++) {
      var at = seq.audioTracks[a];
      if (!at) continue;
      var audioClips = [];
      var numAClips = at.clips ? at.clips.numItems : 0;
      for (var ac = 0; ac < numAClips; ac++) {
        var aclip = at.clips[ac];
        if (!aclip) continue;
        try {
          audioClips.push({
            name: aclip.name || ("audio_" + ac),
            start_seconds: aclip.start ? parseFloat(aclip.start.seconds) : 0,
            end_seconds: aclip.end ? parseFloat(aclip.end.seconds) : 0
          });
        } catch (ae) { }
      }
      info.audio_tracks.push({
        index: a,
        name: at.name || ("Audio " + (a + 1)),
        clip_count: audioClips.length,
        clips: audioClips
      });
    }

    return JSON.stringify(info);
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Apply approved edit suggestions to the active sequence.
 * Supports razor cuts and sequence markers.
 *
 * @param {string} suggestionsJSON - JSON array of approved suggestion objects
 * @returns {string} JSON result with applied count and any errors
 */
function applyEditSuggestions(suggestionsJSON) {
  try {
    if (!app.project) {
      return JSON.stringify({ success: false, error: "No project open." });
    }
    var seq = app.project.activeSequence;
    if (!seq) {
      return JSON.stringify({ success: false, error: "No active sequence." });
    }

    var suggestions;
    try {
      suggestions = JSON.parse(suggestionsJSON);
    } catch (pe) {
      return JSON.stringify({ success: false, error: "Invalid suggestions JSON: " + pe.toString() });
    }

    var applied = 0;
    var markersAdded = 0;
    var errors = [];

    for (var i = 0; i < suggestions.length; i++) {
      var s = suggestions[i];
      var timeSec = parseFloat(s.time_seconds) || 0;
      var action = s.action || "razor_cut";

      try {
        if (action === "razor_cut") {
          // Attempt razor cut on the specified video track (or all tracks if track_index == -1)
          var trackIdx = (s.track_index !== undefined && s.track_index >= 0) ? s.track_index : -1;
          var cutApplied = false;

          var numVT = seq.videoTracks ? seq.videoTracks.numTracks : 0;
          for (var tv = 0; tv < numVT; tv++) {
            if (trackIdx >= 0 && tv !== trackIdx) continue;
            var vtr = seq.videoTracks[tv];
            if (!vtr) continue;
            var numCl = vtr.clips ? vtr.clips.numItems : 0;
            for (var tc = 0; tc < numCl; tc++) {
              var tclip = vtr.clips[tc];
              if (!tclip) continue;
              var clipStart = tclip.start ? parseFloat(tclip.start.seconds) : 0;
              var clipEnd = tclip.end ? parseFloat(tclip.end.seconds) : 0;
              // Check if cut time falls inside this clip (with 0.1s tolerance)
              if (timeSec > clipStart + 0.1 && timeSec < clipEnd - 0.1) {
                tclip.razor(timeSec);
                cutApplied = true;
              }
            }
          }

          if (cutApplied) {
            applied++;
          }

          // Always add a sequence marker so the edit point is visible
          try {
            var marker = seq.markers.createMarker(timeSec);
            marker.name = "AI Cut: " + (s.reason ? s.reason.substring(0, 40) : "");
            marker.comments = s.reason || "";
            marker.colorByIndex = s.confidence === "high" ? 3 : (s.confidence === "medium" ? 1 : 0);
            markersAdded++;
          } catch (me) { }

        } else if (action === "add_marker" || action === "camera_note") {
          // Just add a marker — no cut
          try {
            var mkr = seq.markers.createMarker(timeSec);
            mkr.name = (s.track_label || "AI Note") + ": " + (s.reason ? s.reason.substring(0, 40) : "");
            mkr.comments = s.reason || "";
            mkr.colorByIndex = 4; // blue for notes
            markersAdded++;
            applied++;
          } catch (me) {
            errors.push("Marker " + i + ": " + me.toString());
          }
        }
      } catch (se) {
        errors.push("Suggestion " + (s.id || i) + " at " + timeSec + "s: " + se.toString());
      }
    }

    return JSON.stringify({
      success: true,
      applied: applied,
      markers_added: markersAdded,
      errors: errors
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Apply razor cuts from a parsed cut sheet (IN and OUT points for each clip).
 * Cuts all video and audio tracks at every in_seconds / out_seconds position,
 * then adds green (IN) and red (OUT) sequence markers.
 *
 * @param {string} clipsJSON - JSON array: [{id, section, in_seconds, out_seconds, ...}]
 * @returns {string} JSON: { success, cuts_applied, markers_added, errors[] }
 */
function applyCutSheetClips(clipsJSON) {
  try {
    if (!app.project) return JSON.stringify({ success: false, error: "No project open." });
    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });

    var clips;
    try { clips = JSON.parse(clipsJSON); } catch (pe) {
      return JSON.stringify({ success: false, error: "Invalid JSON: " + pe.toString() });
    }

    // Collect all unique cut points from all clips
    var cutTimes = [];
    var timeSet = {};
    for (var i = 0; i < clips.length; i++) {
      var inSec = parseFloat(clips[i].in_seconds);
      var outSec = parseFloat(clips[i].out_seconds);
      if (!timeSet[inSec]) { cutTimes.push(inSec); timeSet[inSec] = true; }
      if (!timeSet[outSec]) { cutTimes.push(outSec); timeSet[outSec] = true; }
    }
    cutTimes.sort(function (a, b) { return a - b; });

    var cutsApplied = 0;
    var markersAdded = 0;
    var errors = [];

    // Apply razor cuts on all video tracks at each cut time
    for (var p = 0; p < cutTimes.length; p++) {
      var timeSec = cutTimes[p];

      var numVT = seq.videoTracks ? seq.videoTracks.numTracks : 0;
      for (var tv = 0; tv < numVT; tv++) {
        var vtr = seq.videoTracks[tv];
        if (!vtr) continue;
        var numCl = vtr.clips ? vtr.clips.numItems : 0;
        for (var tc = 0; tc < numCl; tc++) {
          var tclip = vtr.clips[tc];
          if (!tclip) continue;
          var cStart = tclip.start ? parseFloat(tclip.start.seconds) : 0;
          var cEnd = tclip.end ? parseFloat(tclip.end.seconds) : 0;
          if (timeSec > cStart + 0.05 && timeSec < cEnd - 0.05) {
            try { tclip.razor(timeSec); cutsApplied++; } catch (re) {
              errors.push("V" + (tv + 1) + "@" + timeSec.toFixed(2) + "s: " + re.toString());
            }
            break; // break inner loop — clips list changed after razor
          }
        }
      }

      // Audio tracks
      var numAT = seq.audioTracks ? seq.audioTracks.numTracks : 0;
      for (var ta = 0; ta < numAT; ta++) {
        var atr = seq.audioTracks[ta];
        if (!atr) continue;
        var numAC = atr.clips ? atr.clips.numItems : 0;
        for (var ac = 0; ac < numAC; ac++) {
          var aclip = atr.clips[ac];
          if (!aclip) continue;
          var acStart = aclip.start ? parseFloat(aclip.start.seconds) : 0;
          var acEnd = aclip.end ? parseFloat(aclip.end.seconds) : 0;
          if (timeSec > acStart + 0.05 && timeSec < acEnd - 0.05) {
            try { aclip.razor(timeSec); } catch (re) { }
            break;
          }
        }
      }
    }

    // Add sequence markers: green for IN, red for OUT
    for (var m = 0; m < clips.length; m++) {
      var c = clips[m];
      var label = (c.section || ("Clip " + (m + 1)));
      try {
        var mIn = seq.markers.createMarker(parseFloat(c.in_seconds));
        mIn.name = "IN: " + label;
        mIn.colorByIndex = 3; // green
        markersAdded++;
      } catch (me) { }
      try {
        var mOut = seq.markers.createMarker(parseFloat(c.out_seconds));
        mOut.name = "OUT: " + label;
        mOut.colorByIndex = 1; // red/orange
        markersAdded++;
      } catch (me) { }
    }

    return JSON.stringify({ success: true, cuts_applied: cutsApplied, markers_added: markersAdded, errors: errors });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Add IN/OUT markers for cut-sheet clips without making any razor cuts.
 * Safe preview mode for editors to review before committing.
 *
 * @param {string} clipsJSON - JSON array of clip objects with in_seconds/out_seconds
 * @returns {string} JSON result
 */
function addCutSheetMarkersOnly(clipsJSON) {
  try {
    if (!app.project) return JSON.stringify({ success: false, error: "No project open." });
    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });

    var clips;
    try { clips = JSON.parse(clipsJSON); } catch (pe) {
      return JSON.stringify({ success: false, error: "Invalid JSON: " + pe.toString() });
    }

    var markersAdded = 0;
    var errors = [];

    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      var label = (c.section || ("Clip " + (i + 1)));
      try {
        var mIn = seq.markers.createMarker(parseFloat(c.in_seconds));
        mIn.name = "IN: " + label;
        mIn.colorByIndex = 3; // green
        markersAdded++;
      } catch (me) { errors.push("IN " + i + ": " + me.toString()); }
      try {
        var mOut = seq.markers.createMarker(parseFloat(c.out_seconds));
        mOut.name = "OUT: " + label;
        mOut.colorByIndex = 1; // red/orange
        markersAdded++;
      } catch (me) { errors.push("OUT " + i + ": " + me.toString()); }
    }

    return JSON.stringify({ success: true, markers_added: markersAdded, errors: errors });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Get info about the currently selected clip in the active sequence.
 * The editor must click on a clip in the timeline before calling this.
 *
 * @returns {string} JSON: { success, name, track_index, start_seconds, end_seconds, duration_seconds, media_path }
 */
function getSelectedClipInfo() {
  try {
    if (!app.project) return JSON.stringify({ success: false, error: "No project open." });
    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });

    var selection;
    try { selection = seq.getSelection(); } catch (se) {
      return JSON.stringify({ success: false, error: "getSelection() not supported: " + se.toString() });
    }

    if (!selection || selection.length === 0) {
      return JSON.stringify({ success: false, error: "No clip selected. Click on a clip in the Premiere timeline first." });
    }

    var clip = selection[0];
    var mediaPath = "";
    try {
      if (clip.projectItem && clip.projectItem.getMediaPath) {
        mediaPath = clip.projectItem.getMediaPath() || "";
      }
    } catch (mp) { }

    return JSON.stringify({
      success: true,
      name: clip.name || "Unknown Clip",
      track_index: (clip.parentTrackIndex !== undefined) ? clip.parentTrackIndex : 0,
      start_seconds: clip.start ? parseFloat(clip.start.seconds) : 0,
      end_seconds: clip.end ? parseFloat(clip.end.seconds) : 0,
      duration_seconds: clip.duration ? parseFloat(clip.duration.seconds) : 0,
      media_path: mediaPath
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Apply razor cuts at silence regions in a clip.
 * Silences are absolute timeline positions (matching the audio track start at 0s).
 *
 * @param {string} silencesJSON - JSON array: [{in_seconds, out_seconds, duration_seconds}]
 * @returns {string} JSON: { success, applied, markers_added, errors[] }
 */
function removeClipSilences(silencesJSON) {
  try {
    if (!app.project) return JSON.stringify({ success: false, error: "No project open." });
    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });

    var silences;
    try { silences = JSON.parse(silencesJSON); } catch (pe) {
      return JSON.stringify({ success: false, error: "Invalid JSON: " + pe.toString() });
    }

    var applied = 0;
    var markersAdded = 0;
    var errors = [];

    for (var i = 0; i < silences.length; i++) {
      var inSec = parseFloat(silences[i].in_seconds);
      var outSec = parseFloat(silences[i].out_seconds);
      var durStr = (silences[i].duration_seconds || 0).toFixed(2);

      // Razor video tracks at silence in and out points
      var numVT = seq.videoTracks ? seq.videoTracks.numTracks : 0;
      for (var tv = 0; tv < numVT; tv++) {
        var vtr = seq.videoTracks[tv];
        if (!vtr) continue;

        // Cut at silence in point
        var nIn = vtr.clips ? vtr.clips.numItems : 0;
        for (var c1 = 0; c1 < nIn; c1++) {
          var cl1 = vtr.clips[c1];
          if (!cl1) continue;
          var s1 = cl1.start ? parseFloat(cl1.start.seconds) : 0;
          var e1 = cl1.end ? parseFloat(cl1.end.seconds) : 0;
          if (inSec > s1 + 0.05 && inSec < e1 - 0.05) {
            try { cl1.razor(inSec); applied++; } catch (re) {
              errors.push("V" + (tv + 1) + " sil-in@" + inSec.toFixed(2) + ": " + re.toString());
            }
            break;
          }
        }

        // Cut at silence out point
        var nOut = vtr.clips ? vtr.clips.numItems : 0;
        for (var c2 = 0; c2 < nOut; c2++) {
          var cl2 = vtr.clips[c2];
          if (!cl2) continue;
          var s2 = cl2.start ? parseFloat(cl2.start.seconds) : 0;
          var e2 = cl2.end ? parseFloat(cl2.end.seconds) : 0;
          if (outSec > s2 + 0.05 && outSec < e2 - 0.05) {
            try { cl2.razor(outSec); applied++; } catch (re) { }
            break;
          }
        }
      }

      // Audio tracks
      var numAT = seq.audioTracks ? seq.audioTracks.numTracks : 0;
      for (var ta = 0; ta < numAT; ta++) {
        var atr = seq.audioTracks[ta];
        if (!atr) continue;

        var naIn = atr.clips ? atr.clips.numItems : 0;
        for (var a1 = 0; a1 < naIn; a1++) {
          var al1 = atr.clips[a1];
          if (!al1) continue;
          var as1 = al1.start ? parseFloat(al1.start.seconds) : 0;
          var ae1 = al1.end ? parseFloat(al1.end.seconds) : 0;
          if (inSec > as1 + 0.05 && inSec < ae1 - 0.05) {
            try { al1.razor(inSec); } catch (re) { }
            break;
          }
        }

        var naOut = atr.clips ? atr.clips.numItems : 0;
        for (var a2 = 0; a2 < naOut; a2++) {
          var al2 = atr.clips[a2];
          if (!al2) continue;
          var as2 = al2.start ? parseFloat(al2.start.seconds) : 0;
          var ae2 = al2.end ? parseFloat(al2.end.seconds) : 0;
          if (outSec > as2 + 0.05 && outSec < ae2 - 0.05) {
            try { al2.razor(outSec); } catch (re) { }
            break;
          }
        }
      }

      // Orange marker at silence in point
      try {
        var mk = seq.markers.createMarker(inSec);
        mk.name = "SILENCE: " + durStr + "s";
        mk.colorByIndex = 2; // yellow/orange
        markersAdded++;
      } catch (me) { }
    }

    return JSON.stringify({ success: true, applied: applied, markers_added: markersAdded, errors: errors });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Add only markers (no cuts) for all suggestions.
 * Safe preview mode — editor can see suggestions before committing.
 * @param {string} suggestionsJSON - JSON array of suggestion objects
 * @returns {string} JSON result
 */
function addSuggestionsAsMarkersOnly(suggestionsJSON) {
  try {
    if (!app.project) return JSON.stringify({ success: false, error: "No project open." });
    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });

    var suggestions;
    try { suggestions = JSON.parse(suggestionsJSON); } catch (pe) {
      return JSON.stringify({ success: false, error: "Invalid JSON: " + pe.toString() });
    }

    var added = 0;
    var errors = [];

    for (var i = 0; i < suggestions.length; i++) {
      var s = suggestions[i];
      try {
        var timeSec = parseFloat(s.time_seconds) || 0;
        var mkr = seq.markers.createMarker(timeSec);
        var label = (s.action === "razor_cut" ? "[CUT] " : "[NOTE] ");
        mkr.name = label + (s.track_label || "") + " — " + (s.reason ? s.reason.substring(0, 50) : "");
        mkr.comments = "Confidence: " + (s.confidence || "?") + "\n" + (s.reason || "");
        // Color by confidence: green=high, orange=medium, red=low
        mkr.colorByIndex = s.confidence === "high" ? 3 : (s.confidence === "medium" ? 1 : 0);
        added++;
      } catch (me) {
        errors.push("Marker " + i + ": " + me.toString());
      }
    }

    return JSON.stringify({ success: true, markers_added: added, errors: errors });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}
