export const errorMiddleware = (err, _req, res, _next) => {
  console.error('[ErrorMiddleware]', err.message);
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'File too large. Maximum file size is 5MB.',
      code: 'FILE_TOO_LARGE',
    });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({
      success: false,
      error: 'Too many files. Maximum is 50 files at once.',
      code: 'TOO_MANY_FILES',
    });
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    error: err.message || 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
    details: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  });
};
