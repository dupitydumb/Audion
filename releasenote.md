# Release Notes - Audion

## [v1.3.4] - 2026-06-03

### New Features & Enhancements

* **ALAC Audio Support**: Added support for `.alac` audio files across library scanning, metadata parsing, and playback workflows.
* **Expanded Codec Detection**: Implemented codec-aware detection for MP4 containers, allowing reliable identification of ALAC, AAC, and other codecs within MP4-based formats.
* **Broader Format Compatibility**: Expanded support for additional audio codecs and containers, including MKV, OGG, WAV, ISO MP4, and Vorbis.
* **ReplayGain Controls**: Added a ReplayGain toggle for audio processing on the native playback backend.
* **Output Device Selection**: Added an audio output device selector, making it easy to switch between available playback devices directly within the application.
* **Apple Music Lyrics Improvements**: Enhanced lyrics retrieval with smarter fallback mechanisms for improved reliability and coverage.
* **API Key Validation**: Added user-friendly validation and notifications when required API credentials are missing.

### Library & Playback Improvements

* **Symphonia 0.6 Upgrade**: Upgraded the decoding backend to Symphonia 0.6.0, bringing improved format support, decoding reliability, and overall playback enhancements.
* **Enhanced ALAC Parsing**: Updated the file walker and metadata parser to recognize `.alac` files directly, with automatic fallback to MP4 parsing through Lofty when required.
* **Improved Track Matching**: Refined track matching logic to better handle artist name variations and metadata inconsistencies during lyrics lookup and library operations.

### UI & UX Improvements

* **Updated Drag & Drop Support**: Enhanced drag-and-drop interfaces and supported file indicators to include ALAC files throughout the application.
* **Output Device UI**: Added a dedicated device selection dropdown for a smoother audio management experience.

### Documentation

* **Arch Linux Installation Support**: Added official installation instructions for Arch Linux and Arch-based distributions through the AUR package `audion-bin`.
* **AUR Package Availability**: Audion can now be installed and updated natively using package managers such as `yay` and `paru`, with automated release synchronization.
* **Expanded Format Documentation**: Updated the README with a comprehensive list of supported audio formats, codecs, and containers.

### Bug Fixes & Stability

* **Lyrics Fallback Reliability**: Improved lyrics retrieval stability by automatically falling back to alternative sources when the primary provider fails.
* **Metadata Handling Improvements**: Fixed edge cases involving metadata inconsistencies and artist matching across supported music services.
* **Container Parsing Enhancements**: Improved handling of MP4-based audio files and codec detection for greater compatibility across music libraries.

### Notes

* Audion now includes support for standalone `.alac` files in addition to ALAC audio stored within standard M4A containers.
* Due to dependency compatibility requirements, both Symphonia 0.6.0 and 0.5.5 may appear in `Cargo.lock`, as the current Rodio release continues to depend on Symphonia 0.5.5.
