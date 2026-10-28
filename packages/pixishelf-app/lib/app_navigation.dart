import 'package:animations/animations.dart';
import 'package:flutter/material.dart';

/// Keeps spatial context between the gallery, detail, and immersive media.
Route<T> appPageRoute<T>(Widget child, {bool fullscreen = false}) =>
    PageRouteBuilder<T>(
      transitionDuration: const Duration(milliseconds: 280),
      reverseTransitionDuration: const Duration(milliseconds: 220),
      pageBuilder: (context, animation, secondaryAnimation) => child,
      transitionsBuilder: (context, animation, secondaryAnimation, child) {
        if (MediaQuery.of(context).disableAnimations) return child;
        return SharedAxisTransition(
            animation: animation,
            secondaryAnimation: secondaryAnimation,
            transitionType: fullscreen
                ? SharedAxisTransitionType.scaled
                : SharedAxisTransitionType.horizontal,
            fillColor: fullscreen
                ? Colors.black
                : Theme.of(context).scaffoldBackgroundColor,
            child: child);
      },
    );
