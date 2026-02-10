#!/bin/bash

# Quick E2E Test Runner
# Run the full E2E test with all API keys pre-configured

cd "$(dirname "$0")"

./test-full-e2e.sh \
  o2_cma_145656e8f38d1c8f1c02fa9496604360 \
  o2_cda_d53f9f1ccb17741317b47cfdf95d848c \
  o2_cpa_2ff2a05e7d46a77e57e13723690fbe3c

