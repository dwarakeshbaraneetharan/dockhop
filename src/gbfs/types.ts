/** The subset of GBFS 1.1 that Citi Bike publishes and this app reads. */

export interface GbfsStationInformation {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  capacity?: number;
}

export interface GbfsStationStatus {
  station_id: string;
  num_bikes_available: number;
  num_docks_available: number;
  /** Lyft extension. Counted inside num_bikes_available, not alongside it. */
  num_ebikes_available?: number;
  num_bikes_disabled?: number;
  num_docks_disabled?: number;
  is_installed: number | boolean;
  is_renting: number | boolean;
  is_returning: number | boolean;
  last_reported: number;
}

export interface GbfsFeed<T> {
  last_updated: number;
  ttl: number;
  data: T;
}
