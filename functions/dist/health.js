"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = health;
async function health() {
    return {
        status: "ok",
        service: "workflow-builder",
        timestamp: new Date().toISOString()
    };
}
