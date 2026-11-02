export function requireRole(expectedRole) {

    return function (request, response, next) {

        const user = request.session.user;

        if (!user) {
            return response.status(401).json({
                error: "Authentication required"
            });
        }

        if (user.role !== expectedRole) {
            return response.status(403).json({
                error: "You do not have permission to access this resource"
            });
        }

        response.setHeader("Cache-Control", "no-store");

        next();
    };
}