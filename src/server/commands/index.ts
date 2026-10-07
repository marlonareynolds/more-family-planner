// Importing each module registers its commands with the pipeline.
import "./household";
import "./schedule";
import "./moments";
import "./care";
import "./money";
import "./private";
import "./trial";
import "./calendars";
import "./reach";
import "./rituals";
import "./village";

export { executeCommand, commandNames } from "../pipeline";
