'use strict';

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const bad = (message, details) => new ApiError(400, 'bad_request', message, details);
const unauthorized = message => new ApiError(401, 'unauthorized', message);
const forbidden = (message, details) => new ApiError(403, 'forbidden', message, details);
const notFound = message => new ApiError(404, 'not_found', message);
const conflict = (message, details) => new ApiError(409, 'conflict', message, details);
const unprocessable = (message, details) => new ApiError(422, 'unprocessable', message, details);

module.exports = { ApiError, bad, unauthorized, forbidden, notFound, conflict, unprocessable };
