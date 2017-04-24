import { accessor as get } from './accessors'
import dates from './dates'

export function startsBefore(date, min) {
  return dates.lt(dates.merge(min, date), min, 'minutes')
}

export function positionFromDate(date, min, total) {
  if (startsBefore(date, min))
    return 0;

  let diff = dates.diff(min, dates.merge(min, date), 'minutes');
  return Math.min(diff, total)
}

/**
 * Events will be sorted primarily according to earliest start time.
 * If two events start at the same time, the one with the longest duration will
 * be placed first.
 */
let sort = (events, { startAccessor, endAccessor }) => events.sort((a, b) => {
  let startA = +get(a, startAccessor);
  let startB = +get(b, startAccessor);

  if (startA === startB) {
    return +get(b, endAccessor) - +get(a, endAccessor)
  }

  return startA - startB
});

let getSlot = (event, accessor, min, totalMin) => event && positionFromDate(
  get(event, accessor), min, totalMin
);

/**
 * Two events are considered siblings if the difference between their
 * start time is less than to 30 minutes.
 */
let isSibling = (idx1, idx2, { events, startAccessor, min, totalMin }) => {
  let event1 = events[idx1];
  let event2 = events[idx2];

  if (!event1 || !event2) return false;

  let start1 = getSlot(event1, startAccessor, min, totalMin);
  let start2 = getSlot(event2, startAccessor, min, totalMin);

  return (Math.abs(start1 - start2) < 30)
};

/**
 * An event is considered a child of another event if its start time is
 * more than 30 minutes later than the other event's start time,
 * but before its end time.
 */
let isChild = (parentIdx, childIdx, {
  events, startAccessor, endAccessor, min, totalMin
}) => {
  if (isSibling(
    parentIdx, childIdx,
    { events, startAccessor, endAccessor, min, totalMin }
  )) return false;

  let parentEnd = getSlot(events[parentIdx], endAccessor, min, totalMin);
  let childStart = getSlot(events[childIdx], startAccessor, min, totalMin);

  return parentEnd > childStart
};

/**
 * Given an event index, siblings directly following it will be found and
 * returned as an array of indexes.
 */
let getSiblings = (idx, {
  events, startAccessor, endAccessor, min, totalMin
}) => {
  let nextIdx = idx;
  let siblings = [];

  while (isSibling(
    idx, ++nextIdx, { events, startAccessor, endAccessor, min, totalMin })
  ) {
    siblings.push(nextIdx)
  }

  return siblings
};

/**
 * Given an event index, and a start search position, all child events to that
 * event will be found and placed into groups of siblings.
 * The return value is an array of child group arrays, as well as the largest
 * size of the child groups.
 */
let getChildGroups = (idx, nextIdx, {
  events, startAccessor, endAccessor, min, totalMin
}) => {
  let groups = [];
  let nbrOfColumns = 0;

  while (isChild(
    idx, nextIdx,
    { events, startAccessor, endAccessor, min, totalMin }
  )) {
    let childGroup = [nextIdx];
    let siblingIdx = nextIdx;

    while (isSibling(
      nextIdx, ++siblingIdx,
      { events, startAccessor, endAccessor, min, totalMin }
    )) {
      childGroup.push(siblingIdx)
    }

    nbrOfColumns = Math.max(nbrOfColumns, childGroup.length);
    groups.push(childGroup);
    nextIdx = siblingIdx
  }

  return { childGroups: groups, nbrOfChildColumns: nbrOfColumns }
};

/**
 * Returns height and top offset, both in percentage, for an event at
 * the specified index.
 */
let getYStyles = (idx, {
  events, startAccessor, endAccessor, min, totalMin, step
}) => {
  let event = events[idx];
  let start = getSlot(event, startAccessor, min, totalMin);
  let end = Math.max(getSlot(event, endAccessor, min, totalMin), start + step);
  let top = start / totalMin * 100;
  let bottom = end / totalMin * 100;

  return {
    top,
    height: bottom - top
  }
};

const isFirstSibling = (siblingIdx) => siblingIdx === 0;

const isOnlyNestedElement = (group) => group.length === 1;

/**
 * Takes an array of unsorted events, and returns a sorted array
 * containing the same events, but with an additional style property.
 * These styles will position the events similarly to Google Calendar.
 *
 * The algorithm will start by sorting the array, and then iterating over it.
 * Starting at the first event, each of its siblings and children, placed in
 * groups of siblings, will be found. Both are needed in order to calculate the
 * width of the first event. When the width is known, its siblings will be
 * given the same width, but with an incremental x-offset.
 *
 * Each group of children will be looking to move as far away from its original
 * parent as possible. A move can be made to one of the parent's siblings, if
 * that sibling is also a parent to the child group. This will make room for
 * more events.
 *
 * When a child group knows its parent, it looks at the space occupied by that
 * parent, and calculates the remaning available space and divides that among
 * each other.
 *
 * All widths and x-offsets are calculated without taking overlapping into
 * account. Overlapping is added in the end according to the OVERLAP_MULTIPLIER.
 * If that is set to 0, the events won't overlap or grow.
 *
 * When one of these rounds are finished, all events connected have been
 * traversed, so the cursor will be moved past all of them.
 */
export default function getStyledEvents ({
  events: unsortedEvents, startAccessor, endAccessor, min, totalMin, step
}) {
  let events = sort(unsortedEvents, { startAccessor, endAccessor });
  let helperArgs = { events, startAccessor, endAccessor, min, totalMin, step };
  let styledEvents = [];
  let idx = 0;

  // One iteration will cover all connected events.
  while (idx < events.length) {
    let siblings = getSiblings(idx, helperArgs);
    let { childGroups } = getChildGroups(
      idx, idx + siblings.length + 1, helperArgs
    );
    // Set styles to top level events.
    [idx, ...siblings].forEach((eventIdx, siblingIdx) => {
      let width;
      let xOffset;

      if (siblings.length) {
        // styles for top level side-by-side events

        const siblingsNumber = siblings.length + 1;
        events[eventIdx].overlappingCount = siblingsNumber;

        events[eventIdx].groupStart = (siblingIdx === 0);
        events[eventIdx].groupEnd = (siblingIdx === siblings.length);

        width = 100 / siblingsNumber;
        xOffset = (isFirstSibling(siblingIdx))
          ? 0
          : width * siblingIdx;
      } else {
        // styles for top level single event
        width = 100;
        xOffset = 0;
      }

      let { top, height } = getYStyles(eventIdx, helperArgs);

      styledEvents[eventIdx] = {
        event: events[eventIdx],
        style: {
          top,
          height,
          width,
          xOffset
        }
      }
    });

    childGroups.forEach((group, groupIndex) => {
      let parentIdx = idx;
      let siblingIdx = 0;

      // Move child group to sibling if possible, since this will makes
      // room for more events.
      while (isChild(siblings[siblingIdx], group[0], helperArgs)) {
        parentIdx = siblings[siblingIdx];
        siblingIdx++
      }

      // Set styles to child events.
      group.forEach((eventIdx, i) => {
        let { style: parentStyle } = styledEvents[parentIdx];
        let { width: parentWidth, xOffset: parentXOffset } = parentStyle;
        // let columns = Math.min(group.length, nbrOfColumns);
        const event = events[eventIdx];

        const offset = 3;
        const nestedGroupOffset = 3;
        const groupNumber = groupIndex + 1;
        const overlappingCount = group.length;
        let width;
        let xOffset;

        // styles for not overlapping nested elements
        if (isOnlyNestedElement(group)) {
          xOffset = offset * groupNumber;
          width = 100 - xOffset;
        } else {
          const groupOffset = nestedGroupOffset * groupNumber;
          width = ((parentWidth - offset * groupIndex) / overlappingCount) - (offset / overlappingCount);
          const childOffsetInGroup = width * i;
          xOffset = parentXOffset + childOffsetInGroup + groupOffset;
          event.overlappingCount = overlappingCount;
          event.groupNumber = groupNumber;
          event.groupStart = (i === 0);
          event.groupEnd = (i === group.length - 1);
        }

        let { top, height } = getYStyles(eventIdx, helperArgs);

        styledEvents[eventIdx] = {
          event,
          style: {
            top,
            height,
            width,
            xOffset
          }
        }
      })
    });

    // Move past all events we just went through
    idx += 1 + siblings.length + childGroups.reduce(
      (total, group) => total + group.length, 0
    )
  }

  return styledEvents
}
