#!/usr/bin/env node
"use strict";
require("dotenv").config();
try {
  console.log(JSON.stringify({ok:true,...require("../src/runtime-config").validateRuntimeConfig()}));
} catch (error) { console.error(error.message);process.exitCode=1; }
