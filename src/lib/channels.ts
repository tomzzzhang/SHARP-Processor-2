/**
 * Channel / fluorophore label + colour resolution shared across the UI.
 *
 * Channels carry a canonical ID from the parser (a dye name like `FAM` when the
 * file provides one, else `Channel 1` / `default`). The *effective* fluorophore
 * label shown everywhere (hover popup, legend, channel checkboxes, results
 * Fluorophore column) layers a user override on top of the parser-detected dye:
 *
 *   effective label = channelLabels[ch] ?? channelFluorophore[ch] ?? ch
 *
 * The colour layers the user override on top of the dye's default colour.
 */
import { fluorophoreColor } from './constants';

export const DEFAULT_CHANNEL = 'default';

/** Effective fluorophore label for a channel. */
export function effectiveChannelLabel(
  channel: string,
  channelLabels?: Map<string, string>,
  channelFluorophore?: Record<string, string>,
): string {
  return channelLabels?.get(channel) ?? channelFluorophore?.[channel] ?? channel;
}

/** Effective display colour for a channel (user override → dye default). */
export function effectiveChannelColor(
  channel: string,
  channelColors?: Map<string, string>,
  channelLabels?: Map<string, string>,
  channelFluorophore?: Record<string, string>,
): string {
  const override = channelColors?.get(channel);
  if (override) return override;
  return fluorophoreColor(effectiveChannelLabel(channel, channelLabels, channelFluorophore));
}

/** True when the experiment has a single, unnamed `default` channel — i.e. the
 *  channel machinery should stay fully hidden and labels suppressed. */
export function isSingleDefaultChannel(channels: string[]): boolean {
  return channels.length <= 1 && (channels.length === 0 || channels[0] === DEFAULT_CHANNEL);
}
