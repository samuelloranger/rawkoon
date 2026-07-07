interface ApiResponse<T> {
  success: true;
  data: T;
}

interface ApiError {
  success: false;
  error: string;
}

export type ApiResult<T> = ApiResponse<T> | ApiError;
