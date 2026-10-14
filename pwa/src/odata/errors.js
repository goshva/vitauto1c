// Ошибка API в формате Problem ({ code, message, field }) — как у REST API АРМ, чтобы экраны не менялись.
export class ApiError extends Error {
  constructor(status, problem) {
    super((problem && problem.message) || `HTTP ${status}`);
    this.status = status;
    this.code = (problem && problem.code) || 'http_' + status;
    this.field = problem && problem.field;
    this.problem = problem;
  }
}

export const fail = (status, code, message, field) => { throw new ApiError(status, { code, message, field }); };
