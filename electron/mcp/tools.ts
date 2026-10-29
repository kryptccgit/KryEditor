import { z } from 'zod';

export type ToolKind = 'read' | 'write' | 'destructive' | 'history' | 'export';

export interface ToolDef {
  name: string;
  title: string;
  kind: ToolKind;
  description: string;
  input: z.ZodObject;
}

const sec = z.number().min(0).describe('Seconds on the timeline');
const color = z.string().describe('#rrggbb');
const scope = z
  .object({
    track_id: z.string().optional().describe('Listen to every clip on this track'),
    clip_ids: z.array(z.string()).optional().describe('Listen to exactly these clips'),
  })
  .optional()
  .describe('Which clips to analyse. Default: the first video track with audio (never "all audio" — a music bed would mask every pause).');

const detectFields = {
  scope,
  mode: z.enum(['loudness', 'speech']).optional().describe('loudness = instant, quiet stretches of the waveform. speech = Whisper transcript AND loudness: only gaps where nobody talks (handles game audio / music under the voice; needs a transcription pass the first time).'),
  preset: z.enum(['talking', 'voiceover', 'podcast', 'gameplay']).optional().describe('Starting point for the settings below. Default talking.'),
  min_pause: z.number().min(0.2).max(5).optional().describe('Shortest pause worth cutting, seconds'),
  padding: z.number().min(0).max(1).optional().describe('Silence kept after speech, seconds (a bit less is kept before)'),
  sensitivity_db: z.number().min(3).max(30).optional().describe('loudness: dB over the noise floor that counts as sound. speech: dB quieter than the voice a gap must be.'),
  fillers: z.boolean().optional().describe('speech mode: also cut filler words (um, uh, …)'),
  retakes: z.boolean().optional().describe('speech mode: also cut retakes (a 5+ word phrase said again within 15s keeps the last take)'),
};

const anim = z.string().describe('Animation name (list_options → text_animations), e.g. fade, pop, slide, typewriter');

const textStyle = z
  .object({
    font_size: z.number().min(8).max(400).optional(),
    font: z.string().optional().describe('Font name (list_options → fonts)'),
    color: color.optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    x: z.number().min(0).max(1).optional().describe('Horizontal centre, 0..1 of the frame width'),
    y: z.number().min(0).max(1).optional().describe('Vertical centre, 0..1 of the frame height'),
    align: z.enum(['left', 'center', 'right']).optional(),
    outline_width: z.number().min(0).max(40).optional(),
    outline_color: color.optional(),
    glow: z.number().min(0).max(40).optional().describe('Glow radius (0 = off)'),
    glow_color: color.optional(),
    bg_style: z.enum(['none', 'box', 'highlight']).optional().describe('box = one box behind the block, highlight = per-line'),
    bg_color: color.optional(),
    bg_opacity: z.number().min(0).max(1).optional(),
    bg_radius: z.number().min(0).max(40).optional(),
    bg_padding: z.number().min(0).max(60).optional(),
    anim_in: anim.optional(),
    anim_out: anim.optional(),
    karaoke: z.enum(['none', 'color', 'pop', 'box']).optional().describe('Captions only: highlight the spoken word'),
    karaoke_color: color.optional(),
  })
  .optional();

const shapeStyle = {
  fill: z.string().optional().describe('#rrggbb, or "" for no fill'),
  stroke: z.string().optional().describe('#rrggbb outline, or "" for none'),
  stroke_width: z.number().min(0).max(40).optional(),
  x: z.number().min(0).max(1).optional().describe('Centre, fraction of the frame width'),
  y: z.number().min(0).max(1).optional().describe('Centre, fraction of the frame height'),
  w: z.number().min(0.01).max(1).optional().describe('Width, fraction of the frame'),
  h: z.number().min(0.005).max(1).optional().describe('Height, fraction of the frame'),
  rotation: z.number().min(-360).max(360).optional(),
  opacity: z.number().min(0).max(1).optional(),
  anim_in: anim.optional(),
  anim_out: anim.optional(),
};

const mask = z
  .object({
    type: z.enum(['linear', 'rect', 'ellipse']).optional(),
    x: z.number().min(0).max(1).optional().describe('Centre, fraction of the clip box'),
    y: z.number().min(0).max(1).optional(),
    w: z.number().min(0.05).max(1.5).optional(),
    h: z.number().min(0.05).max(1.5).optional(),
    rotation: z.number().min(-360).max(360).optional(),
    feather: z.number().min(0).max(0.5).optional().describe('Soft edge (0 = hard)'),
    invert: z.boolean().optional().describe('Show the outside instead'),
  })
  .nullable();

const targets = {
  clip_id: z.string().optional().describe('One clip'),
  clip_ids: z.array(z.string()).optional().describe('Several clips, changed together in one undo step'),
  track_id: z.string().optional().describe('Every clip on this track (e.g. all the pieces after an auto edit)'),
};

export const TOOLS: ToolDef[] = [
  {
    name: 'get_project',
    title: 'Get project',
    kind: 'read',
    description:
      'Start here. The open project: canvas size, fps, background, duration, playhead, tracks, every clip (id, track, start/end, media, trim, speed, text, and any non-default look: effect, LUT, blend, transition, mask, keyframed props…) and the media library (ids, names, kinds, paths). All times are timeline seconds.',
    input: z.object({}),
  },
  {
    name: 'list_options',
    title: 'List options',
    kind: 'read',
    description:
      'Valid names for everything that takes a name: effects (filters + GPU effects), transitions, blend modes, fonts, text animations, shapes, stickers, speed presets, easings, karaoke styles, background types, imported LUTs, keyframable properties per clip type, and voice-over voices.',
    input: z.object({}),
  },
  {
    name: 'get_transcript',
    title: 'Get transcript',
    kind: 'read',
    description:
      'Whisper transcript with word timings, mapped to TIMELINE time through each clip of the media (cut-out parts are omitted). Use it to find content ("remove the part about X") and then cut_ranges. First call per file transcribes on-device (roughly 1/5 of the clip length); later calls are instant.',
    input: z.object({
      media_id: z.string().optional().describe('Media to transcribe (default: the media of the first audible clip)'),
      language: z.enum(['english', 'multilingual']).optional(),
      words: z.boolean().optional().describe('Include per-word timings (default false: lines only)'),
    }),
  },
  {
    name: 'detect_pauses',
    title: 'Detect pauses',
    kind: 'read',
    description: 'Find dead air (and optionally filler words / retakes) without changing anything. Returns timeline ranges to cut and how much time they total. Apply with cut_ranges, or use auto_edit to do both.',
    input: z.object(detectFields),
  },
  {
    name: 'auto_edit',
    title: 'Auto edit',
    kind: 'destructive',
    description:
      'One-call jump-cut edit: detect pauses (and fillers / retakes in speech mode) and remove them, rippling every unlocked track so audio, captions and overlays stay in sync. Optional alternating punch-in zoom on the cuts and captions from the same transcript. One undo step.',
    input: z.object({
      ...detectFields,
      remove: z.boolean().optional().describe('false = keep every frame and only cut at the pauses (for zooms). Default true.'),
      zoom: z.boolean().optional().describe('Alternate a punch-in zoom on every other piece of a cut video clip'),
      zoom_scale: z.number().min(1.02).max(1.5).optional(),
      captions: z.boolean().optional().describe('speech mode: also add captions'),
    }),
  },
  {
    name: 'cut_ranges',
    title: 'Cut ranges',
    kind: 'destructive',
    description: 'Remove timeline ranges from every unlocked track. ripple=true (default) closes the gaps so everything after slides left; ripple=false leaves gaps. Ranges are [start, end] timeline seconds; overlapping ranges merge. One undo step.',
    input: z.object({
      ranges: z.array(z.tuple([sec, sec])).min(1).max(5000),
      ripple: z.boolean().optional(),
    }),
  },
  {
    name: 'import_media',
    title: 'Import media',
    kind: 'write',
    description: 'Import video, audio or image files by absolute path into the media library. add_to_timeline=true also appends each one to the end of its track.',
    input: z.object({
      paths: z.array(z.string()).min(1).max(50),
      add_to_timeline: z.boolean().optional(),
    }),
  },
  {
    name: 'add_clip',
    title: 'Add clip',
    kind: 'write',
    description: 'Put a library item on the timeline. Defaults: end of the first track of its kind, whole file. in_point trims the head (source seconds); duration is timeline seconds.',
    input: z.object({
      media_id: z.string(),
      start: sec.optional(),
      track_id: z.string().optional(),
      in_point: z.number().min(0).optional(),
      duration: z.number().min(0.1).optional(),
    }),
  },
  {
    name: 'add_text',
    title: 'Add text',
    kind: 'write',
    description: 'Add a title / text overlay, or an emoji sticker (text: "🔥", font_size ~160, anim_in pop). Lands on the first text track (one is created if needed).',
    input: z.object({
      text: z.string().min(1).max(2000),
      start: sec,
      duration: z.number().min(0.1).max(3600),
      track_id: z.string().optional(),
      style: textStyle,
    }),
  },
  {
    name: 'add_shape',
    title: 'Add shape',
    kind: 'write',
    description: 'Add a vector shape overlay (rect, rounded, ellipse, triangle, star, heart, arrow, line) on a text/overlay track — for lower-third bars, highlight boxes, arrows pointing at things.',
    input: z.object({
      shape: z.enum(['rect', 'rounded', 'ellipse', 'triangle', 'star', 'heart', 'arrow', 'line']),
      start: sec,
      duration: z.number().min(0.1).max(3600),
      track_id: z.string().optional(),
      ...shapeStyle,
    }),
  },
  {
    name: 'update_clip',
    title: 'Update clips',
    kind: 'write',
    description:
      'Change clips — one (clip_id), several (clip_ids) or a whole track (track_id) — in one undo step. Pass only what should change. ' +
      'Timing: start, duration, track_id, fade_in / fade_out. ' +
      'Media clips: volume, muted, denoise, speed (constant), opacity, pos_x / pos_y (-1..1, 0 = centred), scale or scale_x / scale_y, rotation, crop_*, blend, ' +
      'colour (brightness / contrast / saturation 100 = unchanged, hue, vignette), effect (a filter or GPU effect: list_options), lut + lut_amount, ' +
      'transition (into this clip from the clip that ends where it starts, same track) + transition_duration, chroma_key, bg_remove (AI background removal), mask. ' +
      'Text clips: text and style. Shapes: the add_shape fields. A GPU effect and a LUT share one render slot, so setting one clears the other; chroma_key and bg_remove are exclusive too.',
    input: z.object({
      ...targets,
      start: sec.optional(),
      duration: z.number().min(0.1).optional(),
      move_to_track: z.string().optional().describe('Move to this track'),
      fade_in: z.number().min(0).max(3).optional(),
      fade_out: z.number().min(0).max(3).optional(),
      volume: z.number().min(0).max(2).optional(),
      muted: z.boolean().optional(),
      denoise: z.boolean().optional().describe('On-device noise reduction (hiss, hum, fans)'),
      speed: z.number().min(0.25).max(4).optional().describe('Constant speed (pitch preserved); duration follows'),
      pos_x: z.number().min(-2).max(2).optional(),
      pos_y: z.number().min(-2).max(2).optional(),
      scale: z.number().min(0.05).max(10).optional(),
      scale_x: z.number().min(0.05).max(10).optional(),
      scale_y: z.number().min(0.05).max(10).optional(),
      crop_top: z.number().min(0).max(0.45).optional().describe('Fraction of the frame'),
      crop_bottom: z.number().min(0).max(0.45).optional(),
      crop_left: z.number().min(0).max(0.45).optional(),
      crop_right: z.number().min(0).max(0.45).optional(),
      blend: z.string().optional().describe('Blend mode (list_options → blend_modes)'),
      brightness: z.number().min(0).max(300).optional(),
      contrast: z.number().min(0).max(300).optional(),
      saturation: z.number().min(0).max(300).optional(),
      hue: z.number().min(-180).max(180).optional().describe('Hue shift, degrees'),
      vignette: z.number().min(0).max(1).optional(),
      effect: z.string().optional().describe('Effect name (list_options → effects); "none" clears'),
      lut: z.string().nullable().optional().describe('Imported LUT id or name (import_lut); null clears'),
      lut_amount: z.number().min(0).max(1).optional(),
      transition: z.string().optional().describe('Transition name (list_options → transitions); "none" clears'),
      transition_duration: z.number().min(0.1).max(3).optional(),
      chroma_key: z
        .object({
          enabled: z.boolean().optional(),
          color: color.optional().describe('Key colour (default green #00d800)'),
          similarity: z.number().min(0).max(1).optional(),
          smoothness: z.number().min(0).max(0.5).optional(),
        })
        .optional(),
      bg_remove: z.boolean().optional(),
      mask: mask.optional().describe('Clip mask (merged over the current/default one); null removes it'),
      text: z.string().max(2000).optional(),
      style: textStyle,
      ...shapeStyle,
    }),
  },
  {
    name: 'set_keyframes',
    title: 'Set keyframes',
    kind: 'write',
    description:
      'Animate one property of a clip over time (Ken Burns zooms, slides, fades, volume ducking, speed ramps). keyframes are {time (TIMELINE seconds, inside the clip), value, ease?}; they replace any existing keyframes of that property (an empty list removes the animation). Properties: media pos_x, pos_y, scale (or scale_x / scale_y), rotation, opacity, volume, speed; text / shapes / drawings x, y, opacity.',
    input: z.object({
      clip_id: z.string(),
      property: z.string(),
      keyframes: z
        .array(
          z.object({
            time: sec,
            value: z.number(),
            ease: z.enum(['linear', 'in', 'out', 'inout']).optional().describe('Curve into this keyframe from the previous one'),
          }),
        )
        .max(200),
    }),
  },
  {
    name: 'retime_clip',
    title: 'Retime clip',
    kind: 'write',
    description:
      'Speed effects on a media clip: speed_preset (montage, hero, bullet, jump; none = back to constant), freeze_at (insert a freeze frame at that timeline time, pushing the rest of the track right), or reverse (renders a reversed copy of the used footage, max 60s, video only).',
    input: z.object({
      clip_id: z.string(),
      speed_preset: z.enum(['none', 'montage', 'hero', 'bullet', 'jump']).optional(),
      freeze_at: sec.optional(),
      freeze_duration: z.number().min(0.2).max(30).optional().describe('Default 3'),
      reverse: z.boolean().optional(),
    }),
  },
  {
    name: 'split_clips',
    title: 'Split clips',
    kind: 'write',
    description: 'Split at a timeline time: the given clips, or every clip under that time on unlocked tracks.',
    input: z.object({ time: sec, clip_ids: z.array(z.string()).optional() }),
  },
  {
    name: 'duplicate_clip',
    title: 'Duplicate clip',
    kind: 'write',
    description: 'Copy a clip with all its settings. Default: right after the original on the same track.',
    input: z.object({ clip_id: z.string(), start: sec.optional(), track_id: z.string().optional() }),
  },
  {
    name: 'detach_audio',
    title: 'Detach audio',
    kind: 'write',
    description: 'Move a video clip\'s sound onto its own audio-track clip (the video clip is muted), so the audio can be trimmed or moved separately.',
    input: z.object({ clip_id: z.string() }),
  },
  {
    name: 'delete_clips',
    title: 'Delete clips',
    kind: 'destructive',
    description: 'Delete clips. ripple=true closes each gap on that clip\'s own track only (other tracks are untouched).',
    input: z.object({ clip_ids: z.array(z.string()).min(1), ripple: z.boolean().optional() }),
  },
  {
    name: 'edit_track',
    title: 'Edit track',
    kind: 'write',
    description: 'Add a track (kind video / audio / text — text tracks hold titles, captions, shapes, stickers), remove one (with its clips), or change one: name, muted, solo, locked, hidden.',
    input: z.object({
      action: z.enum(['add', 'remove', 'update']),
      track_id: z.string().optional().describe('remove / update'),
      kind: z.enum(['video', 'audio', 'text']).optional().describe('add'),
      name: z.string().max(40).optional(),
      muted: z.boolean().optional(),
      solo: z.boolean().optional(),
      locked: z.boolean().optional(),
      hidden: z.boolean().optional(),
    }),
  },
  {
    name: 'add_captions',
    title: 'Add captions',
    kind: 'write',
    description: 'Transcribe the audible clips (or one track) with Whisper and add word-timed caption clips on a text track. Restyle them afterwards with update_clip (track_id of the caption track + style).',
    input: z.object({
      track_id: z.string().optional().describe('Only caption clips on this track'),
      language: z.enum(['english', 'multilingual']).optional(),
      karaoke: z.enum(['none', 'color', 'pop', 'box']).optional().describe('Highlight the word being spoken (default color)'),
    }),
  },
  {
    name: 'add_voiceover',
    title: 'Add voice-over',
    kind: 'write',
    description: 'Generate speech on-device (text to speech) and place it on an audio track. The first English line downloads the voice model (about 340 MB, unless Krypt Studio already has it); numbers, money and abbreviations are read out naturally.',
    input: z.object({
      text: z.string().min(1).max(4000),
      start: sec.optional().describe('Default: the playhead'),
      voice: z.string().optional().describe('Voice (list_options → voices): 28 English voices (Kokoro, e.g. "Heart (US female, warm)", "Michael (US male)", "George (UK male)"), or Spanish / French / German / Portuguese / Korean. Default Heart.'),
    }),
  },
  {
    name: 'revoice',
    title: 'Re-voice',
    kind: 'write',
    description:
      'Replace the speech in a clip with an AI voice at the original timing: transcribes it (cached), speaks each line with a Kokoro English voice (lines that run long are sped up slightly to fit), puts the result on a new "Re-voice" audio track and mutes or lowers the original. One undo step. To change what is said, pass lines (e.g. from get_transcript, edited); otherwise the transcript is used as is.',
    input: z.object({
      media_id: z.string().optional().describe('Media whose speech to replace (default: the selected clip, else the first audible clip)'),
      voice: z.string().optional().describe('An English voice from list_options → voices (e.g. "Michael (US male)"). Default Heart.'),
      original: z.enum(['mute', 'lower', 'keep']).optional().describe('What happens to the recorded audio. lower = 20% volume, keeps game sound / music under the new voice. Default mute.'),
      lines: z
        .array(z.object({ start: sec, end: sec.optional(), text: z.string().max(2000) }))
        .max(2000)
        .optional()
        .describe('Lines to speak in timeline seconds (replaces the transcript). Empty text skips a line.'),
    }),
  },
  {
    name: 'reframe',
    title: 'Auto reframe',
    kind: 'write',
    description:
      'Change the canvas shape (e.g. 9:16 for TikTok / Shorts / Reels) and fill it with the footage, following the face of the speaker with smooth pans (on-device face detection) or keeping it centred. Footage without a clear face (gameplay with a small facecam, b-roll) stays centred. Writes posX keyframes and scales clips to fill. One undo step.',
    input: z.object({
      aspect: z.enum(['9:16', '1:1', '4:5', '16:9']).describe('New canvas shape.'),
      follow: z.enum(['face', 'center']).optional().describe('face (default) pans to keep the speaker in shot; center fills from the middle (instant).'),
      clip_ids: z.array(z.string()).max(2000).optional().describe('Only these clips (default: every video and image clip on unlocked tracks).'),
    }),
  },
  {
    name: 'duck_audio',
    title: 'Auto duck',
    kind: 'write',
    description:
      'Lower music / game audio / other tracks while someone talks and bring it back in the pauses (eased volume keyframes; pauses under ~1 s stay ducked). Speech is found from a stored transcript of the voice clip when there is one, else from its loudness. Needs the voice and the music on separate tracks. Re-running recomputes the same keys. One undo step.',
    input: z.object({
      voice_track_id: z.string().optional().describe('Track with the voice (default: a voice-over / re-voice track, else the recording).'),
      track_ids: z.array(z.string()).max(50).optional().describe('Tracks to lower (default: every other track with sound).'),
      amount_db: z.number().min(-40).max(-1).optional().describe('How far down, dB. Default -12; -18 for near silence under the voice, -6 for a light dip.'),
    }),
  },
  {
    name: 'import_lut',
    title: 'Import LUT',
    kind: 'write',
    description: 'Load a .cube colour LUT by absolute path (it is saved inside the project). Optionally apply it right away to clips (clip_ids or track_id).',
    input: z.object({
      path: z.string(),
      clip_ids: z.array(z.string()).optional(),
      track_id: z.string().optional(),
      amount: z.number().min(0).max(1).optional(),
    }),
  },
  {
    name: 'set_canvas',
    title: 'Set canvas',
    kind: 'write',
    description: 'Project settings: frame size (aspect preset — 16:9, 9:16 vertical for TikTok/Shorts/Reels, 1:1, 4:5 — or width/height), fps, and the background behind the video (black, color, gradient, or a blurred copy of the clip — nice for vertical crops of horizontal footage).',
    input: z.object({
      aspect: z.enum(['16:9', '9:16', '1:1', '4:5']).optional(),
      width: z.number().int().min(64).max(7680).optional(),
      height: z.number().int().min(64).max(7680).optional(),
      fps: z.number().int().min(12).max(120).optional(),
      background: z.enum(['black', 'color', 'gradient', 'blur']).optional(),
      background_color: color.optional(),
      background_color2: color.optional().describe('Second gradient colour'),
    }),
  },
  {
    name: 'preview_frames',
    title: 'Preview frames',
    kind: 'read',
    description: 'Render what the export would show at up to 6 timeline times and return them as images, so you can check framing, text, effects and zooms.',
    input: z.object({
      times: z.array(sec).min(1).max(6),
      height: z.number().int().min(144).max(1080).optional().describe('Image height in px (default 360)'),
    }),
  },
  {
    name: 'undo',
    title: 'Undo',
    kind: 'history',
    description: 'Undo the last edits (yours or the user\'s — it is one shared history).',
    input: z.object({ steps: z.number().int().min(1).max(50).optional() }),
  },
  {
    name: 'redo',
    title: 'Redo',
    kind: 'history',
    description: 'Redo undone edits.',
    input: z.object({ steps: z.number().int().min(1).max(50).optional() }),
  },
  {
    name: 'save_project',
    title: 'Save project',
    kind: 'write',
    description: 'Save the project as a .krypt file. No path: saves over the project\'s current file, or into the working folder if it was never saved. A new path never overwrites an existing file (" (2)" is added).',
    input: z.object({ path: z.string().optional() }),
  },
  {
    name: 'open_project',
    title: 'Open project',
    kind: 'destructive',
    description: 'Open a .krypt project by absolute path, replacing what is open (this clears undo history). Refused while there are unsaved changes unless discard_unsaved is true — save_project first, or only discard when the user said so.',
    input: z.object({ path: z.string(), discard_unsaved: z.boolean().optional() }),
  },
  {
    name: 'export_video',
    title: 'Export video',
    kind: 'export',
    description:
      'Render the timeline to a file. path = absolute output path (.mp4 / .webm; audio-only timelines write .m4a); default is the user\'s working folder. Never overwrites: an existing name gets " (2)". Returns the final path. Takes about as long as playing the video.',
    input: z.object({
      path: z.string().optional(),
      format: z.enum(['mp4', 'webm']).optional(),
      height: z.number().int().min(144).max(2160).optional().describe('Output height in px (width follows the canvas). Default 1080.'),
      fps: z.number().int().min(12).max(60).optional(),
      quality: z.enum(['low', 'medium', 'high']).optional(),
      loudness: z.number().min(-36).max(-5).optional().describe('Normalize the mix to this integrated loudness in LUFS, peaks held under -1 dB: -14 for YouTube/Spotify/TikTok, -16 for podcasts, -23 broadcast. Default: leave the mix as it is.'),
    }),
  },
];

export function annotationsFor(def: ToolDef): Record<string, boolean | string> {
  return {
    title: def.title,
    readOnlyHint: def.kind === 'read',
    destructiveHint: def.kind === 'destructive',
    idempotentHint: def.kind === 'read',
    openWorldHint: false,
  };
}

export const SERVER_INSTRUCTIONS = `Krypt Editor is a video editor running on the user's computer. These tools edit the project that is open in it, live: the user watches every change, and each tool call is one undo step.

How to work:
- Call get_project first; ids and times come from it. All times are timeline seconds. Call list_options before using names (effects, transitions, fonts, animations…).
- To replace someone's voice with an AI voice (bad mic, narrator voice, fixing a fumbled line): revoice. To change the words, get_transcript first and pass the edited lines.
- To make a vertical short: reframe (aspect 9:16), then export. To put music under a voice: add the music on its own audio track, then duck_audio. For platform-ready volume, export with loudness -14.
- To tighten a talking video: auto_edit (preset talking, mode speech for gameplay or music under the voice). To cut specific content: get_transcript, find the lines, then cut_ranges.
- Looks apply to many clips at once: update_clip with track_id (e.g. every piece after an auto edit) or clip_ids.
- Check visual changes with preview_frames.
- Pass any file path the user gives you straight to import_media, import_lut, open_project, save_project or export_video; never open media with your own file tools.
- Don't stop to ask for approval between steps: everything is undoable. Finish the request, then summarise what changed in a sentence or two.`;
