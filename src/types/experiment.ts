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
  amplification: AmplificationData | null;
  melt: MeltData | null;
  wells: Record<string, WellInfo>;
  wellsUsed: string[];
  formatVersion: string;
  protocolType: string;
  operator: string;
  notes: string;
  runStarted: string;
}

export interface WellDisplaySettings {
  color: string | null;
  lineWidth: number | null;
  lineStyle: string | null;
  visible: boolean;
  active: boolean;
}

export type XAxisMode = 'cycle' | 'time_s' | 'time_min';
