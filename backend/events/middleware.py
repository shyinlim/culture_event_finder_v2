import uuid

from toolkitsy.logger import set_correlation_id


class CorrelationIdMiddleware:
    """Assign a correlation id per request: log it and expose via X-Request-ID response header."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
        set_correlation_id(request_id)
        response = self.get_response(request)
        response["X-Request-ID"] = request_id
        return response
