# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Wordvale is a macOS desktop application built with a web frontend in Tauri. Its experience should follow macOS conventions.

## Users

Everyday Mac users, including students, professionals, researchers, and content creators, who need to turn recordings, lectures, interviews, meetings, and other audio into readable, searchable text. The primary workflow must be understandable to nontechnical users while retaining advanced controls for power users.

## Product Purpose

Make local transcription quick, accurate, private, and reliable. Users import recordings, run transcription, review results, and export or manage transcripts without sending their recordings to a cloud service.

## Positioning

Wordvale runs transcription and audio processing locally using Whisper models, without a cloud account, remote transcription API, or usage caps. Models can be downloaded once and reused offline.

## Operating Context

Users work on a Mac with local audio or video files. They can queue multiple files, choose a model and language, review results, and export transcripts. A local library keeps recordings and transcripts available between sessions; recordings can be linked or copied into managed storage.

## Capabilities and Constraints

- Preserve existing transcription engines, backend integrations, processing controls, local storage, and sequential queue management.
- Preserve offline-first operation and privacy. Core transcription and audio processing must not require a cloud account or internet connection; initial model downloads require network access.
- Preserve existing functionality, including transcription, translation to English with supported models, optional word timestamps, model management, and transcript export.
- Keep advanced settings accessible without overwhelming the primary workflow.
- Maintain responsiveness, reliable processing, and transcription accuracy.
- The packaged runtime currently targets Apple silicon macOS.
- Library organization, search, and management are product priorities; do not assume a particular search capability is already implemented without verifying it.

## Brand Commitments

The product is named Wordvale. It should feel like polished, purpose-built Mac software and support a clean, distinctive, professional identity. Avoid excessive visual complexity, unnecessary animation, and generic interface patterns.

## Evidence on Hand

The repository README documents current workflows, implementation, model handling, exports, library behavior, and packaging. The existing application and assets are in `src/` and `src-tauri/icons/`.

## Product Principles

- Keep recordings and transcription under the user's local control.
- Make the import, transcribe, review, and export workflow easy to understand.
- Preserve advanced capabilities while placing them where users can find them when needed.
- Make processing and queue state dependable and understandable.
- Respect macOS conventions and support both keyboard and accessible interactions.

## Accessibility & Inclusion

Maintain accessibility and keyboard interactions. No specific conformance standard has been established.
