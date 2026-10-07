import type { DiagramPlugin, MermaidConfig } from "../plugin-types";

// SVGs of large diagrams run to hundreds of KB
const MAX_ENTRIES = 32;

interface CachedRender {
  // The id the SVG was rendered with
  id: string;
  svg: Promise<string>;
}

// Least recently used first
const cache = new Map<string, CachedRender>();

// Plugins carry their own default config, so renders through different
// plugin instances never share an entry
const pluginKeys = new WeakMap<DiagramPlugin, number>();
let nextPluginKey = 0;

const getPluginKey = (plugin: DiagramPlugin) => {
  let key = pluginKeys.get(plugin);
  if (key === undefined) {
    key = nextPluginKey;
    nextPluginKey += 1;
    pluginKeys.set(plugin, key);
  }
  return key;
};

// Returns null for a config that can't be serialized, which skips the cache
const getCacheKey = (
  plugin: DiagramPlugin,
  chart: string,
  config?: MermaidConfig
) => {
  try {
    return `${getPluginKey(plugin)}\0${JSON.stringify(config ?? null)}\0${chart}`;
  } catch {
    return null;
  }
};

const createRenderId = (chart: string) => {
  const chartHash = chart.split("").reduce((acc, char) => {
    // biome-ignore lint/suspicious/noBitwiseOperators: "Required for Mermaid"
    return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
  }, 0);
  return `mermaid-${Math.abs(chartHash)}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Render a chart to SVG, reusing the layout of an identical earlier render.
 * Every call returns an SVG with its own id, because Mermaid scopes the
 * diagram's CSS and marker references to the id it rendered with, and two
 * copies on the page (inline and fullscreen) must not share one.
 */
export const renderMermaid = async (
  plugin: DiagramPlugin,
  chart: string,
  config?: MermaidConfig
): Promise<string> => {
  const mermaid = plugin.getMermaid(config);
  const id = createRenderId(chart);
  const key = getCacheKey(plugin, chart, config);
  if (key === null) {
    const { svg } = await mermaid.render(id, chart);
    return svg;
  }

  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    const svg = await cached.svg;
    return svg.replaceAll(cached.id, id);
  }

  const entry: CachedRender = {
    id,
    svg: (async () => (await mermaid.render(id, chart)).svg)(),
  };
  cache.set(key, entry);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }

  try {
    return await entry.svg;
  } catch (error) {
    // A failed render may succeed later, so it isn't kept
    if (cache.get(key) === entry) {
      cache.delete(key);
    }
    throw error;
  }
};

/**
 * Drop a render that won't be shown again, such as a partial chart that a
 * stream has since extended, so it doesn't evict finished diagrams.
 */
export const forgetMermaidRender = (
  plugin: DiagramPlugin,
  chart: string,
  config?: MermaidConfig
) => {
  const key = getCacheKey(plugin, chart, config);
  if (key !== null) {
    cache.delete(key);
  }
};
