-- heyhr database schema
-- Compatible with MySQL 8/9

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 1) Create database (idempotent)
CREATE DATABASE IF NOT EXISTS `heyhr`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 2) Select database
USE `heyhr`;

-- 3) Tables

-- users
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NULL,
  `phone` VARCHAR(32) NULL,
  `password_hash` VARCHAR(191) NOT NULL,
  `role` ENUM('RECRUITER','CANDIDATE') NOT NULL DEFAULT 'CANDIDATE',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- candidate_profiles
CREATE TABLE IF NOT EXISTS `candidate_profiles` (
  `user_id` INT NOT NULL,
  `first_name` VARCHAR(191) NULL,
  `last_name` VARCHAR(191) NULL,
  `date_of_birth` DATE NULL,
  `avatar_url` VARCHAR(512) NULL,
  `resume_url` VARCHAR(512) NULL,
  `career_objective` TEXT NULL,
  `education` JSON NULL,
  `experience` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_candidate_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- jobs
CREATE TABLE IF NOT EXISTS `jobs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `recruiter_id` INT NULL,
  `title` VARCHAR(191) NOT NULL,
  `company_name` VARCHAR(191) NULL,
  `location` VARCHAR(191) NULL,
  `remote_flexible` TINYINT(1) NOT NULL DEFAULT 0,
  `job_type` ENUM('FULL_TIME','PART_TIME','CONTRACT','INTERNSHIP','TEMPORARY','FREELANCE') NULL,
  `salary` INT NULL,
  `commencement_date` DATE NULL,
  `intro` TEXT NULL,
  `description` TEXT NULL,
  `responsibilities` JSON NULL,
  `requirements` JSON NULL,
  `qualifications` JSON NULL,
  `other_details` JSON NULL,
  `skills_soft` JSON NULL,
  `skills_technical` JSON NULL,
  `skills_cognitive` JSON NULL,
  `hiring_start_date` DATE NULL,
  `hiring_end_date` DATE NULL,
  `application_start_date` DATE NULL,
  `application_end_date` DATE NULL,
  `allow_international` TINYINT(1) NOT NULL DEFAULT 0,
  `auto_close` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('DRAFT','PUBLISHED','CLOSED') NOT NULL DEFAULT 'DRAFT',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_jobs_recruiter_id` (`recruiter_id`),
  KEY `idx_jobs_status` (`status`),
  CONSTRAINT `fk_jobs_recruiter` FOREIGN KEY (`recruiter_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- recruiter_profiles
CREATE TABLE IF NOT EXISTS `recruiter_profiles` (
  `user_id` INT NOT NULL,
  `first_name` VARCHAR(191) NULL,
  `last_name` VARCHAR(191) NULL,
  `date_of_birth` DATE NULL,
  `company_name` VARCHAR(191) NULL,
  `position` VARCHAR(191) NULL,
  `avatar_url` VARCHAR(512) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
