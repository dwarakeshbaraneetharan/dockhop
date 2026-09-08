/**
 * Tile attribution. Required by OpenStreetMap's licence, and rendered here
 * rather than as a map control because app chrome covers every map corner.
 */
export function MapCredit() {
  return (
    <p className="pt-2 text-center text-[10px] text-slate-400">
      Map data{" "}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer noopener"
        className="underline"
      >
        © OpenStreetMap
      </a>{" "}
      contributors, tiles by{" "}
      <a
        href="https://openfreemap.org/"
        target="_blank"
        rel="noreferrer noopener"
        className="underline"
      >
        OpenFreeMap
      </a>{" "}
      and OpenMapTiles. Dock data from the Citi Bike GBFS feed.
    </p>
  );
}
