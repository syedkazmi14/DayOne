import type { ShotSpec } from '@/types'

/* ============================================================================
 * SHOW WORLDS — where each show's version of an episode takes place.
 *
 * An episode is one graph, recast per show. Its scenery should not be shared:
 * a Rick and Morty episode happens on a space station, a Simpsons one at the
 * power plant. Each world restates the procedural environments (lobby, desk,
 * server room…) as they exist in that universe, in that show's look, and
 * gives the cold open its own establishing shot.
 *
 * Deliberately generic: no show names, no character names, no "in the style
 * of". Image models draw settings and an art direction reliably; they do not
 * draw existing characters reliably, and should not be asked to. The cast
 * appears as its own portraits and voices, on top of these images.
 * ========================================================================== */

export interface ShowWorld {
  /** Art direction, described without naming the show. */
  style: string
  /** Each procedural environment, as it exists in this world. */
  env: Record<ShotSpec['env'], string>
  /** The cold open as a single shot an image-to-video model can animate. */
  coldOpen: { still: string; action: string }
}

export const SHOW_WORLDS: Record<string, ShowWorld> = {
  'rick-and-morty': {
    style: '2D adult animated sci-fi cartoon, bold clean outlines, flat saturated colors, retro-futurist alien technology',
    env: {
      lobby: 'the arrivals deck of an office space station orbiting a strange alien planet, docking bays and holographic signs',
      desk: 'a cluttered desk inside a space-station office, a round porthole showing stars and a swirling green portal',
      open_office: 'an open-plan office aboard a space station, blob-shaped alien coworkers out of focus, floating holographic screens',
      corridor: 'a curved space-station corridor with glowing wall panels and exposed tubes',
      server_room: 'an alien server bay full of bubbling glass tubes and blinking green lights',
      night_office: 'the space-station office during its night cycle, desks empty, stars and a gas giant outside the windows',
      rooftop: 'an observation dome on top of a space station overlooking a ringed alien planet',
    },
    coldOpen: {
      still: 'a small battered flying saucer approaching a floating space-station office in orbit around an alien planet, stars and a green portal glowing in the distance',
      action: 'the flying saucer glides through space and docks gently at the space-station office',
    },
  },
  'south-park': {
    style: '2D paper cut-out animation, simple flat construction-paper shapes, visible paper texture, bright primary colors',
    env: {
      lobby: 'the front lobby of a small-town office building, snow piled against the glass doors, mountains outside',
      desk: 'a cheap office desk in a small mountain-town office, snow falling past the window',
      open_office: 'a cramped small-town open office with wood paneling, a coffee maker and frosted windows',
      corridor: 'a narrow office hallway with a bulletin board and snowy boots by the door',
      server_room: 'a tiny closet server room with tangled cables and a space heater',
      night_office: 'the small-town office at night, snow falling under a streetlight outside',
      rooftop: 'the flat roof of an office building overlooking a snowy mountain town and pine trees',
    },
    coldOpen: {
      still: 'a quiet snowy mountain town in the morning, a small office building on the main street, pine trees and white peaks behind',
      action: 'snow falls as the camera drifts down the main street toward the office building',
    },
  },
  'family-guy': {
    style: '2D adult animated sitcom cartoon, clean thin outlines, warm flat colors, simple rounded shapes',
    env: {
      lobby: 'the lobby of a mid-size office in a New England suburb, beige walls and a reception desk',
      desk: 'a cubicle desk in a suburban New England office, a window onto tree-lined streets',
      open_office: 'a beige open-plan office with cubicles and a water cooler, autumn trees outside',
      corridor: 'a carpeted office hallway lined with framed motivational posters',
      server_room: 'a small office server room with one humming rack and a desk fan',
      night_office: 'the suburban office after dark, a lone desk lamp and streetlights outside',
      rooftop: 'an office rooftop overlooking a small harbor town with church steeples',
    },
    coldOpen: {
      still: 'a leafy New England suburban street in the morning, a brick office building at the end of the road',
      action: 'the camera pushes slowly down the tree-lined street toward the brick office building',
    },
  },
  'the-simpsons': {
    style: '2D classic animated sitcom, thick outlines, bright flat colors with a warm yellow palette, simple rounded shapes',
    env: {
      lobby: 'the entrance lobby of a nuclear power plant office, safety posters and a security desk',
      desk: 'a messy office desk inside a power plant, a donut box and a flickering monitor, cooling towers through the window',
      open_office: 'a power plant control-room office with blinking consoles and a large warning sign',
      corridor: 'a power plant corridor with yellow hazard stripes and a radiation warning sign',
      server_room: 'a humming power plant machine room with glowing green rods behind glass',
      night_office: 'the power plant office at night, consoles glowing, cooling towers lit up outside',
      rooftop: 'a rooftop overlooking a small American town with two cooling towers on the horizon',
    },
    coldOpen: {
      still: 'a small American town on a clear morning, a nuclear power plant with two cooling towers at the edge of town',
      action: 'clouds drift past as the camera glides toward the nuclear power plant',
    },
  },
}

export const showWorld = (groupId: string | null | undefined): ShowWorld | undefined =>
  groupId ? SHOW_WORLDS[groupId] : undefined
