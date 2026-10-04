import uuid

from toolkitsy.logger import logger, set_correlation_id


class CorrelationIdMiddleware:
    """Attach a unique correlation ID to every request and response.

    This isolates interleaved logs across concurrent worker threads and
    allows clients to report the request ID when debugging production issues.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Reuse existing client request ID or generate a standard 36-character UUID4.
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())

        # Bind request ID to thread-local contextvars so all logger calls carry it.
        set_correlation_id(request_id)

        response = self.get_response(request)

        # Expose request ID in response header for client inspection and Render log search.
        response["X-Request-ID"] = request_id

        # Log completed request with correlation ID so access log is never anonymous.
        logger.info("%s %s %s", request.method, request.get_full_path(), response.status_code)
        return response
