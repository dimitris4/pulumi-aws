import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as apigateway from "@pulumi/aws-apigateway";
import * as functions from "./functions";
import {RestAPI} from "@pulumi/aws-apigateway";
import {Output} from "@pulumi/pulumi";
import {UserPool} from "@pulumi/aws/cognito";

const userPool: UserPool = new aws.cognito.UserPool("user-pool");

const api: RestAPI = new apigateway.RestAPI("api", {
    routes: [
        {
            path: "/login",
            method: "POST",
            eventHandler: new aws.lambda.CallbackFunction("login-handler", {
                memorySize: 256, // 128, 256MB
                callback: functions.login,
            }),
        },
        {
            path: "/signup",
            method: "POST",
            eventHandler: new aws.lambda.CallbackFunction("signup-handler", {
                memorySize: 256, // 128, 256MB
                callback: functions.signup,
            }),
        },
        {
            path: "/user-profile",
            method: "GET",
            eventHandler: new aws.lambda.CallbackFunction("get-user-profile-handler", {
                memorySize: 256, // 128, 256MB
                callback: functions.getUserProfile,
            }),
            authorizers: [
                {
                    parameterName: "Authorization",
                    identitySource: ["method.request.header.Authorization"],
                    providerARNs: [userPool.arn],
                },
            ],
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

// Export the url of the api
export const ApiUrl: Output<string> = api.url;
