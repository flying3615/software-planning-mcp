# Google OAuth Authentication Implementation Plan

## Task 1: Design authentication architecture with Google OAuth
**Complexity: 6**

Design the authentication architecture that will use Google OAuth 2.0 for user authentication. This includes:
- Define the authentication flow (Authorization Code flow)
- Determine token storage mechanism
- Plan session management approach
- Define user data model with Google profile information
- Design permission levels/roles

## Task 2: Set up Google OAuth credentials and configuration
**Complexity: 4**

Create a Google Cloud Project and configure OAuth credentials:
- Create a project in Google Cloud Console
- Set up OAuth consent screen (external or internal)
- Configure OAuth credentials (client ID and client secret)
- Define authorized redirect URIs
- Store credentials securely using environment variables
- Create a configuration module for OAuth settings

```javascript
// Example configuration module
import dotenv from 'dotenv';
dotenv.config();

export const googleOAuthConfig = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
  scopes: ['profile', 'email']
};
```

## Task 3: Update data models for Google authentication
**Complexity: 7**

Update data models to support Google authentication:
- Modify User type to include Google-specific fields (googleId, email, picture)
- Add OAuth tokens storage (access token, refresh token, expiry)
- Create session management interfaces and types
- Update StorageData interface to include authenticated sessions
- Define authentication state and error types

```typescript
// Example updated User interface
export interface User {
  id: string;
  googleId: string;
  name: string;
  email: string;
  picture?: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

// Session type for managing authenticated state
export interface Session {
  id: string;
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  createdAt: string;
}

// Updated StorageData to include sessions
export interface StorageData {
  users: Record<string, User>;
  goals: Record<string, Goal>;
  plans: Record<string, ImplementationPlan>;
  sessions: Record<string, Session>;
}
```

## Task 4: Enhance storage class to handle Google authentication
**Complexity: 8**

Extend the existing storage class to support Google OAuth authentication:
- Add methods for creating and retrieving users by Google ID
- Implement session management (create, retrieve, validate, and delete sessions)
- Add token refresh functionality
- Update goal creation to associate with authenticated users
- Ensure backward compatibility with existing data

```typescript
// Example methods to add to Storage class
async getUserByGoogleId(googleId: string): Promise<User | null> {
  for (const userId in this.data.users) {
    const user = this.data.users[userId];
    if (user.googleId === googleId) {
      return user;
    }
  }
  return null;
}

async createSession(userId: string, accessToken: string, refreshToken?: string, expiresIn?: number): Promise<Session> {
  const session: Session = {
    id: crypto.randomUUID(),
    userId,
    accessToken,
    refreshToken,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
    createdAt: new Date().toISOString()
  };

  this.data.sessions[session.id] = session;
  await this.save();
  return session;
}

async getSessionById(sessionId: string): Promise<Session | null> {
  return this.data.sessions[sessionId] || null;
}
```

## Task 5: Implement OAuth endpoints in FastMCP server
**Complexity: 9**

Add the necessary OAuth endpoints to handle Google authentication flow:
- Create auth/google/login endpoint to initiate OAuth flow
- Implement auth/google/callback endpoint to handle OAuth response
- Add session validation middleware
- Implement token refresh logic
- Create logout functionality
- Handle authentication errors gracefully

```typescript
// Example of implementing OAuth endpoints with FastMCP

// Add auth tools to the server
this.server.addTool({
  name: 'login_with_google',
  description: 'Initiate Google OAuth login flow',
  parameters: z.object({}),
  execute: async () => {
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.append('client_id', googleOAuthConfig.clientId);
    authUrl.searchParams.append('redirect_uri', googleOAuthConfig.redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', googleOAuthConfig.scopes.join(' '));
    authUrl.searchParams.append('access_type', 'offline');
    authUrl.searchParams.append('prompt', 'consent');
    
    // Return URL that client should redirect to
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ redirectUrl: authUrl.toString() })
        }
      ]
    };
  }
});
```

## Task 6: Configure FastMCP server with authentication middleware
**Complexity: 8**

Configure the FastMCP server to use authentication middleware for protected resources and tools:
- Implement the FastMCP authenticate function to validate session tokens
- Extract session token from request headers or cookies
- Validate tokens and attach user data to session context
- Handle expired tokens and trigger refresh when needed
- Implement role-based access control for tools and resources
- Create proper error responses for unauthorized access

```typescript
// Example of configuring FastMCP with authentication middleware
const server = new FastMCP({
  name: 'software-planning-tool',
  version: '0.1.0',
  authenticate: async (request) => {
    // Get session token from cookie or Authorization header
    const sessionToken = request.cookies?.session || 
      request.headers.authorization?.replace('Bearer ', '');
    
    if (!sessionToken) {
      throw new Response(null, {
        status: 401,
        statusText: 'Authentication required'
      });
    }
    
    // Validate session and get user data
    const session = await storage.getSessionById(sessionToken);
    if (!session) {
      throw new Response(null, {
        status: 401,
        statusText: 'Invalid or expired session'
      });
    }
    
    // Check if token is expired
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      if (session.refreshToken) {
        // Attempt to refresh the token
        try {
          const refreshedSession = await refreshGoogleToken(session);
          return {
            userId: refreshedSession.userId,
            sessionId: refreshedSession.id
          };
        } catch (error) {
          throw new Response(null, {
            status: 401,
            statusText: 'Session expired'
          });
        }
      } else {
        throw new Response(null, {
          status: 401,
          statusText: 'Session expired'
        });
      }
    }
    
    // Return user data to be available in context.session
    const user = await storage.getUser(session.userId);
    return {
      userId: user.id,
      role: user.role,
      name: user.name,
      sessionId: session.id
    };
  }
});
```

## Task 7: Update tools and resources to enforce user permissions
**Complexity: 7**

Modify existing tools and resources to work with the authenticated user context:
- Update all tool handlers to check user permissions before execution
- Add user-specific goal filtering
- Modify the currentGoal property to be user-specific
- Update resource handlers to validate user access
- Create helper functions to validate user permissions for goals
- Add admin-only tools for user management

```typescript
// Example of updating a tool to enforce permissions
this.server.addTool({
  name: 'start_planning',
  description: 'Start a new planning session with a goal',
  parameters: z.object({
    goal: z.string().describe('The software development goal to plan')
  }),
  execute: async (args, { session }) => {
    // Ensure user is authenticated
    if (!session || !session.userId) {
      throw new UserError('Authentication required');
    }
    
    // Check if user has permission to create goals
    const user = await storage.getUser(session.userId);
    if (user.role === UserRole.READONLY) {
      throw new UserError('You do not have permission to create goals');
    }
    
    // Create the goal with user association
    this.currentGoal = await storage.createGoal(args.goal, session.userId);
    await storage.createPlan(this.currentGoal.id);
    
    return SEQUENTIAL_THINKING_PROMPT;
  }
});
```

## Task 8: Create user management interface tools
**Complexity: 6**

Implement user management tools for admins to manage users:
- Add whoami tool for users to check their authentication status
- Create list_users tool for admins to view all users
- Implement update_user_role tool for admins to change user permissions
- Add user_profile tool to view and update profile information
- Create user onboarding flow for first-time Google login
- Add automatic role assignment based on email domain (optional)

```typescript
// Example user management tools

// Tool for users to check their own identity
this.server.addTool({
  name: 'whoami',
  description: 'Get information about the currently authenticated user',
  parameters: z.object({}),
  execute: async (args, { session }) => {
    if (!session || !session.userId) {
      throw new UserError('Not authenticated');
    }
    
    const user = await storage.getUser(session.userId);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      picture: user.picture
    };
  }
});

// Admin tool to list all users
this.server.addTool({
  name: 'list_users',
  description: 'List all users (admin only)',
  parameters: z.object({}),
  execute: async (args, { session }) => {
    if (!session || !session.userId) {
      throw new UserError('Authentication required');
    }
    
    const user = await storage.getUser(session.userId);
    if (user.role !== UserRole.ADMIN) {
      throw new UserError('Admin permission required');
    }
    
    const users = await storage.getUsers();
    return users.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }));
  }
});
```

## Task 9: Create environment configuration and deployment setup
**Complexity: 5**

Set up environment configuration and deployment for the OAuth implementation:
- Create a .env.example file with all required OAuth variables
- Document OAuth configuration requirements
- Create a README section on authentication setup
- Add environment variable validation on startup
- Implement a development mode for easier testing
- Add error handling for missing configuration

```
# Example .env.example file
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
SESSION_SECRET=your_session_secret
AUTH_ENABLED=true
ADMIN_EMAIL_DOMAINS=yourcompany.com,example.com
```

```typescript
// Example environment validation
function validateEnvironment() {
  const requiredVars = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI'
  ];
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please check your .env file or environment configuration');
    process.exit(1);
  }
}
```
