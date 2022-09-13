const { ApolloServer, gql } = require('apollo-server-express');
const { 
  ApolloServerPluginDrainHttpServer,
  ApolloServerPluginLandingPageLocalDefault 
} = require('apollo-server-core');
const http = require('http');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { WebSocketServer } = require('ws');
const { PubSub, withFilter } = require('graphql-subscriptions');
const { useServer } = require('graphql-ws/lib/use/ws');

const express = require('express');

const messages = [];
const pubSub = new PubSub();

const typeDefs = gql`
  type Message {
    id: ID!
    user: String!
    content: String!
  }

  type Query {
    messages: [Message!]
  }

  type Mutation {
    postMessage(user: String!, content: String!): ID!
  }

  type Subscription {
    messages: [Message!]
  }
`;

const resolvers = {
  Query: {
    messages: () => messages,
  },
  Mutation: {
    postMessage: (parent, args, context) => {
      const id = messages.length;

      messages.push({
        id,
        user: args.user,
        content: args.content
      });

      pubSub.publish('POST_MESSAGE', { postMessage: { user: args.user, content: args.content } });

      return id;
    }
  },
  Subscription: {
    messages: {
      subscribe: (_, args, context) => {
        return pubSub.asyncIterator(['POST_MESSAGE'])
      },
      resolve: (payload) => {
        console.log(payload, messages);
        return messages;
      },
    },
  }
}

const schema = makeExecutableSchema({ typeDefs, resolvers })

const startApolloServer = async (schema) => {
  const app = express();
  const httpServer =  http.createServer(app);

  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql'
  })
  const serverCleanup = useServer({ schema }, wsServer);

  const server = new ApolloServer({
    schema,
    csrfPrevention: true,
    cache: 'bounded',
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
      ApolloServerPluginLandingPageLocalDefault({ embed: true }),
    ],
    subscriptions: {
      onConnect: () => console.log('Connected to websocket'),
      onDisconnect: webSocket => console.log(`Disconnected from websocket ${webSocket}`),
    },
  })
  
  await server.start();
  server.applyMiddleware({ app });

  const PORT = 4000;
  httpServer.listen(PORT, () => {
    console.log(
      `Server is now running on http://localhost:${PORT}${server.graphqlPath}`,
    );
  });
}

startApolloServer(schema);