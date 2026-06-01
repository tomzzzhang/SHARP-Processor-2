export type WellCall = 'unset' | 'positive' | 'negative' | 'invalid';

export type ContentType = 'Unkn' | 'Neg Ctrl' | 'Pos Ctrl' | 'Std' | 'NPC' | 'Neg' | '';

export interface WellInfo {
  well: string;
  sample: string;
  content: ContentType;
  cq: number | null;
  endRfu: number | null;
  meltTempC: number | null;
  meltPeakHeight: number | null;
  call: WellCall;
}

export interface AmplificationData {
  cycle: number[];
  timeS: number[];
  timeMin: number[];
  wells: Record<string, number[]>;
}

export interface MeltData {
  temperatureC: number[];
  rfu: Record<string, number[]>;
  derivative: Record<string, number[]>;
}

export interface ExperimentData {
  experimentId: string;
  sourcePath: string;
  metadata: Record<string, unknown>;
  /** Canonical channel IDs in display order. `['default']` for single-channel
   *  files. The funnel (`buildExperimentData`) and `.sharp` loader always
   *  populate this; `normalizeExperiment` backfills it for any path that
   *  predates the channel model. */
  channels: string[];
  /** Parser-detected dye per channel (FAM/VIC/…) when the file provides one. */
  channelFluorophore?: Record<string, string>;
  /** Amplification data keyed by channel ID. */
  amplificationByChannel: Record<string, AmplificationData | null>;
  /** Melt data keyed by channel ID. */
  meltByChannel: Record<string, MeltData | null>;
  /** DERIVED → the active channel's amplification. A live pointer the store
   *  re-points on channel switch, so channel-agnostic code keeps reading it. */
  amplification: AmplificationData | null;
  /** DERIVED → the active channel's melt. */
  melt: MeltData | null;
  wells: Record<string, WellInfo>;
  wellsUsed: string[];
  plateRows: number;
  plateCols: number;
  formatVersion: string;
  protocolType: string;
  operator: string;
  notes: string;
  runStarted: string;
  /** Transient working-session state (selections, analysis/style settings),
   *  populated by the `.sharpx` loader and consumed by `loadExperiment`.
   *  NOT part of the saved data model — plain `.sharp` files never carry it. */
  session?: Record<string, unknown> | null;
}

export interface WellDisplaySettings {
  color: string | null;
  lineWidth: number | null;
  lineStyle: string | null;
  visible: boolean;
  active: boolean;
}

export type XAxisMode = 'cycle' | 'time_s' | 'time_min';
