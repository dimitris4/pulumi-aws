import {RestAPI} from "@pulumi/aws-apigateway";
import * as apigateway from "@pulumi/aws-apigateway";
import * as aws from "@pulumi/aws";
import * as httpHandlers from "./http-handlers";
import {UsagePlan} from "@pulumi/aws/apigateway";
import * as pulumi from "@pulumi/pulumi";

const stack = pulumi.getStack(); // dimitrios-dev, dev OR prod

const api: RestAPI = new apigateway.RestAPI(`api-${stack}`, {
    routes: [
        {
            path: "/login",
            method: "POST",
            eventHandler: new aws.lambda.CallbackFunction("login-handler", {
                memorySize: 256, // 128, 256MB
                callback: httpHandlers.login,
            }),
            apiKeyRequired: true,
        },
        {
            path: "/signup",
            method: "POST",
            eventHandler: new aws.lambda.CallbackFunction("signup-handler", {
                memorySize: 256, // 128, 256MB
                callback: httpHandlers.signup,
            }),
            apiKeyRequired: true,
        },
        {
            path: "/user-profile",
            method: "GET",
            eventHandler: new aws.lambda.CallbackFunction("get-user-profile-handler", {
                memorySize: 256, // 128, 256MB
                callback: httpHandlers.getUserProfile,
            }),
            apiKeyRequired: true,
        },
        {
            path: "/terms-and-conditions",
            target: {
                type: "http_proxy",
                uri: "https://www.google.com",
            },
        },
    ],
    apiKeySource: "AUTHORIZER",
});

// Create an API key to manage usage
const apiKey = new aws.apigateway.ApiKey("api-key");

// Define usage plan for an API stage
const usagePlan: UsagePlan = new aws.apigateway.UsagePlan("usage-plan", {
    apiStages: [{
        apiId: api.api.id,
        stage: api.stage.stageName,
        // throttles: [{ path: "/login", rateLimit:2 }, ]
    }],
    // quotaSettings: {...},
    // throttleSettings: {...},
});

// Associate the key to the plan
new aws.apigateway.UsagePlanKey("usage-plan-key", {
    keyId: apiKey.id,
    keyType: "API_KEY",
    usagePlanId: usagePlan.id,
});

export const ApiGateway = api;