-- Atomic global bound for anonymous public clients, across workers and IPs.
-- Cleanup is a separate bounded write on registration, so a rejected insert
-- cannot roll back reclamation of an existing backlog. No records purged here.
CREATE TRIGGER coursely_bound_unused_oauth_clients
BEFORE INSERT ON oauth_client
WHEN NEW.user_id IS NULL AND NEW.reference_id IS NULL
 AND NEW.client_discovery_id IS NULL AND NEW.client_secret IS NULL
 AND NEW.token_endpoint_auth_method = 'none' AND COALESCE(NEW.skip_consent, 0) = 0
BEGIN
 SELECT RAISE(ABORT, 'coursely_unused_oauth_client_limit')
 WHERE (SELECT COUNT(*) FROM (
  SELECT 1 FROM oauth_client
  WHERE user_id IS NULL AND reference_id IS NULL
   AND client_discovery_id IS NULL AND client_secret IS NULL
   AND token_endpoint_auth_method = 'none' AND COALESCE(skip_consent, 0) = 0
   AND NOT EXISTS (SELECT 1 FROM oauth_consent WHERE client_id = oauth_client.client_id)
   AND NOT EXISTS (SELECT 1 FROM oauth_access_token WHERE client_id = oauth_client.client_id)
   AND NOT EXISTS (SELECT 1 FROM oauth_refresh_token WHERE client_id = oauth_client.client_id)
  LIMIT 100
 )) >= 100;
END;
